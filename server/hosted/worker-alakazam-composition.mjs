import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PLATFORM_BASE_DOMAIN,
  SelfHostRuntime
} from "../selfhost/src/index.mjs";
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
  createAlakazam35PublicationPort
} from "./alakazam-35-publication-port.mjs";
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
  createPostgresAlakazamRetainedPremiumRepository
} from "./alakazam-retained-premium-postgres.mjs";
import {
  createPostgresCommerceV2Adapter
} from "./commerce-v2-postgres.mjs";
import { createSparkCompilerPort } from "./spark-compiler-port.mjs";

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(moduleRoot, "../..");

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
  environment = process.env,
  log = () => {},
  policyRepositoryFactory =
    createPostgresAlakazamPolicyAuthorityRepository
} = {}) {
  let commonPromise = null;
  let fulfillmentPromise = null;
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
        const dataRoot = path.resolve(
          environment.SITESOURCERY_DATA_ROOT ??
            "/var/lib/sitesourcery"
        );
        const approvalPath =
          environment.SITESOURCERY_PUBLICATION_APPROVAL_PATH ??
          "/etc/sitesourcery/PUBLICATION_APPROVED";
        const holdPaths = [
          path.join(moduleRoot, "PUBLICATION_HOLD"),
          path.join(
            repositoryRoot,
            "server",
            "selfhost",
            "PUBLICATION_HOLD"
          ),
          "/etc/sitesourcery/PUBLICATION_HOLD"
        ];
        const publicationHeld = () =>
          !existsSync(approvalPath) ||
          holdPaths.some((target) => existsSync(target));
        const licensedBaseDomain =
          environment.SITESOURCERY_LICENSED_BASE_DOMAIN ??
          DEFAULT_PLATFORM_BASE_DOMAIN;
        const runtime = await SelfHostRuntime.open({
          root: path.join(dataRoot, "tenant-runtime"),
          publicationHeld,
          controlHost: "127.0.0.1",
          platformBaseDomain: licensedBaseDomain
        });
        const publicationPort = createAlakazam35PublicationPort({
          runtime,
          assetRepository: tier35Repository,
          clock: shared.commerce.clock
        });
        const enabled =
          shared.release.mode === "approved" &&
          shared.workerPolicy.ready === true &&
          publicationHeld() === false;
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
            const [tier35, tier50] = await Promise.all([
              tier35Repository.readiness(),
              tier50Repository.readiness()
            ]);
            return Object.freeze({
              ready:
                enabled &&
                tier35?.ready === true &&
                tier50?.ready === true,
              purpose: "alakazam-fulfillment",
              release: shared.release.mode,
              policy: shared.workerPolicy.state,
              policyCode: shared.workerPolicy.code,
              publication: publicationHeld() ? "held" : "approved",
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

  return Object.freeze({
    "alakazam-fulfillment": fulfillment,
    "alakazam-retained-lifecycle": retainedLifecycle
  });
}
