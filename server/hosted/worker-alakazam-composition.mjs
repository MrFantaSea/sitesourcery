import {
  createAlakazam35Compiler
} from "./alakazam-35-compiler.mjs";
import {
  createAlakazam35FulfillmentRepository,
  createAlakazam35TierCompiler
} from "./alakazam-35-fulfillment.mjs";
import {
  createPostgresAlakazam35Repository
} from "./alakazam-35-postgres.mjs";
import {
  createAlakazam50Compiler
} from "./alakazam-50-compiler.mjs";
import {
  createAlakazam50FulfillmentRepository,
  createAlakazam50TierCompiler
} from "./alakazam-50-fulfillment.mjs";
import {
  createPostgresAlakazam50Repository
} from "./alakazam-50-postgres.mjs";
import {
  createAlakazamFulfillmentWorker
} from "./alakazam-fulfillment-worker.mjs";
import {
  createConfiguredAlakazamLifecyclePolicy
} from "./alakazam-lifecycle-policy-config.mjs";
import {
  createPostgresAlakazamPolicyAuthorityRepository
} from "./alakazam-policy-authority-postgres.mjs";
import {
  createPostgresAlakazamRepository
} from "./alakazam-postgres.mjs";
import {
  createConfiguredAlakazamRelease,
  isReleasedAlakazamPolicyReadiness
} from "./alakazam-release-config.mjs";
import {
  createAlakazamRetainedPremiumLifecycle
} from "./alakazam-retained-premium-lifecycle.mjs";
import {
  createLeasedLifecycleWorker,
  lifecycleWorkerOptionsFromEnvironment
} from "./leased-lifecycle-worker.mjs";
import {
  createPublicationControlWorkerExecutor
} from "./publication-control-worker-executor.mjs";
import {
  createPostgresPublicationControlWorkerRepository
} from "./publication-control-worker-postgres.mjs";
import {
  createPostgresAlakazamRetainedPremiumRepository
} from "./alakazam-retained-premium-postgres.mjs";
import {
  createPostgresCommerceV2Adapter
} from "./commerce-v2-postgres.mjs";
import { createSparkCompilerPort } from "./spark-compiler-port.mjs";

export const ALAKAZAM_WORKER_POLICY_READINESS_SCHEMA =
  "sitesourcery.alakazam-worker-policy-readiness/v1";

export function alakazamWorkerPolicyReadiness(value) {
  const released = isReleasedAlakazamPolicyReadiness(value);
  return Object.freeze({
    schema: ALAKAZAM_WORKER_POLICY_READINESS_SCHEMA,
    ready: released,
    state: released ? "released" : "held",
    code: released
      ? "READY"
      : "ALAKAZAM_WORKER_POLICY_NOT_RELEASED",
    commercialEffects: released,
    providerEffects: released,
    publicationEffects: released,
    automaticRestoration: false
  });
}

async function readWorkerPolicy(repository) {
  try {
    return alakazamWorkerPolicyReadiness(
      await repository.readiness()
    );
  } catch {
    return alakazamWorkerPolicyReadiness(null);
  }
}

function requiredEnvironment(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || value.length === 0) {
    const error = new Error(`${name} is required.`);
    error.code = "WORKER_DEPENDENCY_NOT_READY";
    throw error;
  }
  return value;
}

export function createAlakazamWorkerFactories({
  authority,
  publicationPort = null,
  environment = process.env,
  log = () => {},
  policyRepositoryFactory =
    createPostgresAlakazamPolicyAuthorityRepository
} = {}) {
  let commonPromise = null;
  let fulfillmentPromise = null;
  let publicationPromise = null;
  let lifecyclePromise = null;

  async function common() {
    if (!commonPromise) {
      commonPromise = Promise.resolve().then(async () => {
        const commerce = createPostgresCommerceV2Adapter({ authority });
        const policyRepository = policyRepositoryFactory({ authority });
        const workerPolicy = await readWorkerPolicy(policyRepository);
        return Object.freeze({
          commerce,
          release: createConfiguredAlakazamRelease({ environment }),
          lifecyclePolicy:
            createConfiguredAlakazamLifecyclePolicy({ environment }),
          workerPolicy
        });
      });
    }
    return commonPromise;
  }

  async function fulfillment({ loop }) {
    if (!fulfillmentPromise) {
      fulfillmentPromise = (async () => {
        const shared = await common();
        const baseRepository = createPostgresAlakazamRepository({
          authority
        });
        const tier35Repository =
          createPostgresAlakazam35Repository({ authority });
        const tier50Repository =
          createPostgresAlakazam50Repository({ authority });
        const repository = createAlakazam50FulfillmentRepository({
          baseRepository: createAlakazam35FulfillmentRepository({
            baseRepository,
            tierRepository: tier35Repository
          }),
          tierRepository: tier50Repository
        });
        const compiler = await createSparkCompilerPort({
          expectedSourceDigest: requiredEnvironment(
            environment,
            "SITESOURCERY_SPARK_COMPILER_SHA256"
          )
        });
        const tier35Compiler = createAlakazam35TierCompiler({
          baseCompiler: compiler,
          alakazam35Compiler: createAlakazam35Compiler({
            baseCompiler: compiler
          })
        });
        const tier50Compiler = createAlakazam50TierCompiler({
          baseCompiler: tier35Compiler,
          alakazam50Compiler: createAlakazam50Compiler({
            baseCompiler: tier35Compiler
          })
        });
        if (
          !publicationPort ||
          typeof publicationPort.readiness !== "function" ||
          typeof publicationPort.request !== "function" ||
          typeof publicationPort.unpublish !== "function"
        ) {
          const error = new Error(
            "The private publication command client is required."
          );
          error.code = "WORKER_DEPENDENCY_NOT_READY";
          throw error;
        }
        const publication = await publicationPort.readiness();
        const enabled =
          shared.release.mode === "approved" &&
          shared.workerPolicy.ready === true &&
          publication?.ready === true && publication?.held === false;
        return Object.freeze({
          worker: createAlakazamFulfillmentWorker({
            repository,
            compiler: tier50Compiler,
            publicationPort,
            clock: shared.commerce.clock,
            ids: shared.commerce.ids,
            enabled,
            ...loop,
            log
          }),
          async readiness() {
            const [tier35, tier50, currentPublication] = await Promise.all([
              tier35Repository.readiness(),
              tier50Repository.readiness(),
              publicationPort.readiness()
            ]);
            return Object.freeze({
              ready:
                enabled &&
                tier35?.ready === true &&
                tier50?.ready === true &&
                currentPublication?.ready === true &&
                currentPublication?.held === false,
              purpose: "alakazam-fulfillment",
              release: shared.release.mode,
              policy: shared.workerPolicy.state,
              policyCode: shared.workerPolicy.code,
              publication:
                currentPublication?.ready === true &&
                  currentPublication?.held === false
                  ? "approved"
                  : "held",
              publicationTransportReady:
                currentPublication?.ready === true,
              providerEffects:
                enabled ? "owner-approved" : "held"
            });
          }
        });
      })();
    }
    return fulfillmentPromise;
  }

  async function retainedLifecycle({ loop }) {
    if (!lifecyclePromise) {
      lifecyclePromise = (async () => {
        const shared = await common();
        const repository =
          createPostgresAlakazamRetainedPremiumRepository({
            authority
          });
        const enabled =
          shared.release.mode === "approved" &&
          shared.workerPolicy.ready === true &&
          shared.lifecyclePolicy.mode === "approved";
        return Object.freeze({
          worker: createAlakazamRetainedPremiumLifecycle({
            repository,
            clock: shared.commerce.clock,
            enabled,
            ...loop,
            log
          }),
          async readiness() {
            const repositoryStatus = await repository.readiness();
            return Object.freeze({
              ready:
                enabled && repositoryStatus?.ready === true,
              purpose: "alakazam-retained-lifecycle",
              release: shared.release.mode,
              policy: shared.workerPolicy.state,
              policyCode: shared.workerPolicy.code,
              lifecyclePolicy: shared.lifecyclePolicy.mode,
              providerEffects: "none"
            });
          }
        });
      })();
    }
    return lifecyclePromise;
  }

  async function publicationControl({ loop }) {
    if (!publicationPromise) {
      publicationPromise = (async () => {
        const shared = await common();
        if (
          !publicationPort ||
          typeof publicationPort.readiness !== "function" ||
          typeof publicationPort.request !== "function" ||
          typeof publicationPort.rollback !== "function" ||
          typeof publicationPort.unpublish !== "function"
        ) {
          const error = new Error(
            "The private publication command client is required."
          );
          error.code = "WORKER_DEPENDENCY_NOT_READY";
          throw error;
        }
        const options = lifecycleWorkerOptionsFromEnvironment(
          environment,
          {
            prefix: "SITESOURCERY_ALAKAZAM_PUBLICATION_WORKER",
            intervalMs: loop.intervalMs,
            errorBackoffMs: loop.errorBackoffMs,
            maximumBackoffMs: loop.maximumBackoffMs
          }
        );
        const repository =
          createPostgresPublicationControlWorkerRepository({ authority });
        const executor = createPublicationControlWorkerExecutor({
          publicationPort
        });
        const publication = await publicationPort.readiness();
        const enabled =
          options.enabled &&
          shared.release.mode === "approved" &&
          shared.workerPolicy.ready === true &&
          publication?.ready === true && publication?.held === false;
        const worker = createLeasedLifecycleWorker({
          purpose: "alakazam-publication",
          repository,
          executor,
          clock: shared.commerce.clock,
          enabled,
          intervalMs: options.intervalMs,
          errorBackoffMs: options.errorBackoffMs,
          maximumBackoffMs: options.maximumBackoffMs,
          batchLimit: options.batchLimit,
          leaseSeconds: options.leaseSeconds,
          log
        });
        return Object.freeze({
          worker,
          async readiness() {
            const [storage, dependency, currentPublication] =
              await Promise.all([
                repository.readiness(),
                executor.readiness(),
                publicationPort.readiness()
              ]);
            const ready = enabled &&
              storage?.ready === true && storage?.verified === true &&
              dependency?.ready === true && dependency?.verified === true &&
              currentPublication?.ready === true &&
              currentPublication?.held === false;
            return Object.freeze({
              ready,
              verified: ready,
              purpose: "alakazam-publication",
              mode: options.mode,
              release: shared.release.mode,
              policy: shared.workerPolicy.state,
              policyCode: shared.workerPolicy.code,
              storageReady: storage?.ready === true,
              publicationTransportReady:
                currentPublication?.ready === true,
              publication: currentPublication?.held === false
                ? "approved"
                : "held",
              providerEffects: enabled ? "owner-approved" : "held",
              code: ready ? null : "ALAKAZAM_PUBLICATION_WORKER_HELD"
            });
          }
        });
      })();
    }
    return publicationPromise;
  }

  return Object.freeze({
    "alakazam-fulfillment": fulfillment,
    "alakazam-publication": publicationControl,
    "alakazam-retained-lifecycle": retainedLifecycle
  });
}
