import assert from "node:assert/strict";
import test from "node:test";

import {
  createConfiguredRecoveryMailPort
} from "../production-ports.mjs";

test("recovery configuration defaults to fail-closed production", async () => {
  const port = await createConfiguredRecoveryMailPort({
    environment: {}
  });
  assert.deepEqual(await port.readiness(), {
    ready: false,
    verified: false,
    kind: "recovery-mail",
    mode: "production",
    code: "RECOVERY_TRANSPORT_REQUIRED"
  });
});

test("held recovery is explicit and development sink is never production", async () => {
  const held = await createConfiguredRecoveryMailPort({
    environment: {
      SITESOURCERY_RECOVERY_MAIL_MODE: "held"
    }
  });
  assert.equal((await held.readiness()).mode, "held");
  await assert.rejects(
    createConfiguredRecoveryMailPort({
      environment: {
        NODE_ENV: "production",
        SITESOURCERY_RECOVERY_MAIL_MODE: "dev-sink"
      }
    }),
    (error) =>
      error?.code ===
      "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED"
  );
});

test("production loads only an absolute module with the narrow transport factory", async () => {
  await assert.rejects(
    createConfiguredRecoveryMailPort({
      environment: {
        SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
          "./transport.mjs"
      }
    }),
    (error) =>
      error?.code ===
      "RECOVERY_DELIVERY_CONFIGURATION_REQUIRED"
  );

  let imported = null;
  const port = await createConfiguredRecoveryMailPort({
    environment: {
      SITESOURCERY_RECOVERY_TRANSPORT_MODULE:
        "/reviewed/recovery-transport.mjs"
    },
    async importModule(specifier) {
      imported = specifier;
      return {
        createRecoveryTransport() {
          return {
            async readiness() {
              return {
                ready: true,
                verified: true,
                provider: "reviewed-test-mail"
              };
            },
            async sendRecovery() {
              assert.fail(
                "configuration readiness must not send email"
              );
            }
          };
        }
      };
    }
  });
  assert.equal(
    imported,
    "file:///reviewed/recovery-transport.mjs"
  );
  assert.deepEqual(await port.readiness(), {
    ready: true,
    verified: true,
    kind: "recovery-mail",
    mode: "production",
    provider: "reviewed-test-mail"
  });
});
