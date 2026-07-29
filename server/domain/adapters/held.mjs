import { ExternalEffectError } from "../errors.mjs";

function held(capability) {
  return async () => {
    throw new ExternalEffectError(
      "external_effect_held",
      `${capability} is held; no live provider adapter is installed`,
      { certainty: "not_submitted" }
    );
  };
}

export function createHeldExternalPorts() {
  return Object.freeze({
    registrar: Object.freeze({
      ensureContacts: held("registrar contact preparation"),
      previewRegistration: held("registrar registration preview"),
      confirmRegistration: held("registrar registration confirmation"),
      getOperation: held("registrar operation lookup"),
      getDomain: held("registrar domain lookup"),
      assessTransferOut: held("registrar transfer assessment"),
      setTransferLock: held("registrar transfer lock mutation"),
      getAuthCode: held("registrar transfer auth-code retrieval")
    }),
    payments: Object.freeze({
      authorize: held("payment authorization"),
      voidAuthorization: held("payment authorization void"),
      capture: held("payment capture"),
      refund: held("payment refund")
    }),
    secrets: Object.freeze({
      issueOneTime: held("one-time secret delivery")
    })
  });
}
