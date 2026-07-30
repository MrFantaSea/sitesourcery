(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    root.SiteSourceryAbracadabraCustomerControl = api;
    api.boot(root);
  }
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function clone(value) {
    return value == null
      ? value
      : JSON.parse(JSON.stringify(value));
  }

  function idOf(value) {
    return text(value && (
      value.id
      || value.projectId
      || value.versionId
      || value.quoteId
    ));
  }

  function fragmentToken(locationObject, key) {
    var hash = text(locationObject && locationObject.hash);
    var prefix = "#" + key + "=";
    if (!hash.startsWith(prefix)) return "";
    try {
      return decodeURIComponent(hash.slice(prefix.length));
    } catch (_error) {
      return "";
    }
  }

  function registrationTokenFromLocation(locationObject) {
    return fragmentToken(
      locationObject,
      "verify-registration"
    );
  }

  function recoveryTokenFromLocation(locationObject) {
    return fragmentToken(locationObject, "recovery");
  }

  function registrationOutcome(result) {
    var source =
      result && typeof result === "object"
        ? result
        : {};
    if (
      source.accepted === true
      && source.verificationRequired === true
      && source.delivery === "email"
      && source.emailSent === true
    ) {
      return Object.freeze({
        activationReady: true,
        supportRequired: false,
        message:
          "Check your email and open the Site Sourcery activation link."
      });
    }
    return Object.freeze({
      activationReady: false,
      supportRequired: true,
      message:
        "The activation email could not be confirmed. Nothing was created or charged. Contact Site Sourcery for help."
    });
  }

  function recoveryOutcome(result) {
    var source =
      result && typeof result === "object"
        ? result
        : {};
    if (
      source.delivery === "email"
      && source.emailSent === true
    ) {
      return Object.freeze({
        supportRequired: false,
        message:
          "If that account exists, a recovery email was sent."
      });
    }
    return Object.freeze({
      supportRequired: true,
      message:
        "No recovery email was confirmed. Use the Contact link for account recovery."
    });
  }

  function safeCheckoutDestination(result) {
    var source =
      result && typeof result === "object"
        ? result
        : {};
    var candidate = text(
      source.checkoutUrl
      || source.checkout && source.checkout.url
      || source.payment && source.payment.url
    );
    if (!candidate) return "";
    try {
      var parsed = new URL(candidate);
      if (
        parsed.protocol !== "https:"
        || parsed.hostname !==
          "checkout.stripe.com"
        || parsed.port
        || parsed.username
        || parsed.password
      ) return "";
      return parsed.href;
    } catch (_error) {
      return "";
    }
  }

  function acceptedVersionId(version) {
    if (
      !version
      || typeof version !== "object"
      || typeof version.id !== "string"
    ) return "";
    return version.id.trim();
  }

  function bindAcceptedVersion(
    maker,
    originDigest,
    version
  ) {
    var digest = text(originDigest);
    var versionId = acceptedVersionId(version);
    if (
      !digest
      || !versionId
      || !maker
      || typeof maker.markPlatformVersion !==
        "function"
    ) return false;
    return maker.markPlatformVersion(
      digest,
      versionId
    ) === true;
  }

  function acceptedProjectVersion(project) {
    var versions =
      project && Array.isArray(project.versions)
        ? project.versions
        : [];
    var servingId = text(
      project
      && project.serving
      && project.serving.currentVersionId
    );
    var accepted = versions.filter(function (version) {
      return [
        "accepted",
        "accepted_release",
        "ready_for_release"
      ].includes(
        text(
          version
          && (
            version.candidateState
            || version.state
            || version.status
          )
        ).toLowerCase()
      );
    });
    return (
      accepted.find(function (version) {
        return idOf(version) === servingId;
      })
      || accepted[accepted.length - 1]
      || null
    );
  }

  function verifiedDownloadQuote(
    quote,
    projectId,
    versionId,
    now
  ) {
    var currentTime =
      Number.isFinite(Number(now))
        ? Number(now)
        : Date.now();
    if (
      !quote
      || !idOf(quote)
      || text(quote.offerId) !== "spark_download"
      || text(quote.entitlementKind) !==
        "spark_download"
      || text(
        quote.project && quote.project.projectId
      ) !== text(projectId)
      || text(
        quote.version && quote.version.versionId
      ) !== text(versionId)
      || !quote.price
      || Number(quote.price.amountMinor) !== 500
      || text(quote.price.currency).toUpperCase()
        !== "USD"
      || text(quote.price.billing) !== "one_time"
      || text(quote.disclosureDigest).length !== 64
      || text(quote.snapshotDigest).length !== 64
      || !Number.isFinite(
        Date.parse(quote.expiresAt)
      )
      || Date.parse(quote.expiresAt) <= currentTime
    ) return null;
    return Object.freeze({
      quoteId: idOf(quote),
      projectId: text(projectId),
      versionId: text(versionId),
      price: "$5.00 USD",
      expiresAt: quote.expiresAt,
      disclosure:
        text(
          quote.disclosure
          && quote.disclosure.terms
          && quote.disclosure.terms.projectScope
        )
        || "One Download entitlement applies to this editor project and is not used up by another click."
    });
  }

  function downloadEntitlement(project) {
    var entitlements =
      project && Array.isArray(project.entitlements)
        ? project.entitlements
        : [];
    return entitlements.find(function (entry) {
      return (
        text(entry && (entry.kind || entry.entitlementKind))
          === "spark_download"
        && ["active", "current", "paid"].includes(
          text(entry && (entry.state || entry.status))
            .toLowerCase()
        )
      );
    }) || null;
  }

  function boot(windowObject) {
    var windowRef = windowObject;
    var documentRef =
      windowRef && windowRef.document;
    if (!documentRef) return false;

    var modeModule =
      windowRef.SiteSourceryAbracadabraControlMode;
    var apiModule =
      windowRef.SiteSourceryAbracadabraAPI;
    var controlModule =
      windowRef.SiteSourceryAbracadabraHostedControl;
    var maker =
      windowRef.SiteSourceryAbracadabraMaker;
    var configuration = modeModule
      ? modeModule.resolve(documentRef)
      : { hosted: false };
    if (!configuration.hosted) return false;

    var controlRoom =
      documentRef.getElementById("control-room");
    var status =
      documentRef.getElementById("platform-status");
    var workroom =
      documentRef.getElementById("workroom");
    if (
      !apiModule
      || !controlModule
      || !maker
      || !controlRoom
      || !status
      || !workroom
    ) {
      if (status) {
        status.hidden = false;
        status.textContent =
          "Your account options could not open. Your free preview is still here.";
        status.classList.add("is-error");
      }
      return false;
    }

    var client = apiModule.createClient({
      baseUrl: "/api/v1"
    });
    var control =
      controlModule.createHostedControl({
        api: client,
        catalog: {}
      });
    windowRef
      .SiteSourceryAbracadabraHostedSession =
      control;

    workroom.after(controlRoom);

    var pendingGuestCandidate = null;
    var draftTimer = null;
    var queuedDraft = null;
    var draftSaving = false;
    var lastState = control.getState();
    var activeQuote = null;
    var capabilities = Object.freeze({
      accountRegistration: false,
      accountRecoveryEmail: false,
      downloadQuote: false,
      downloadPayment: false,
      domainPurchase: false,
      publishing: false
    });
    var activationToken =
      registrationTokenFromLocation(
        windowRef.location
      );
    var recoveryToken =
      recoveryTokenFromLocation(
        windowRef.location
      );
    if (
      (activationToken || recoveryToken)
      && windowRef.history
      && typeof windowRef.history.replaceState ===
        "function"
    ) {
      windowRef.history.replaceState(
        null,
        "",
        windowRef.location.pathname
          + windowRef.location.search
      );
    }

    function one(selector, rootNode) {
      return (rootNode || documentRef)
        .querySelector(selector);
    }

    function all(selector, rootNode) {
      return Array.prototype.slice.call(
        (rootNode || documentRef)
          .querySelectorAll(selector)
      );
    }

    function value(name) {
      var field = one('[name="' + name + '"]');
      return field ? field.value : "";
    }

    function announce(message, kind) {
      status.hidden = false;
      status.textContent = message;
      status.classList.toggle(
        "is-error",
        kind === "error"
      );
      status.classList.toggle(
        "is-success",
        kind === "success"
      );
    }

    function explain(error, fallback) {
      var message =
        error && error.message
          ? error.message
          : fallback;
      var requestId =
        error && error.requestId
          ? " Request " + error.requestId + "."
          : "";
      return message + requestId;
    }

    function reducedMotion() {
      return (
        typeof windowRef.matchMedia === "function"
        && windowRef
          .matchMedia(
            "(prefers-reduced-motion: reduce)"
          )
          .matches
      );
    }

    function revealControlRoom(mode) {
      controlRoom.hidden = false;
      if (mode) setAuthMode(mode);
      controlRoom.scrollIntoView({
        behavior: reducedMotion()
          ? "auto"
          : "smooth",
        block: "start"
      });
    }

    function setAuthMode(mode) {
      var selectedMode = text(mode) || "create";
      all("[data-auth-mode]").forEach(
        function (button) {
          var selected =
            button.getAttribute(
              "data-auth-mode"
            ) === selectedMode;
          button.setAttribute(
            "aria-selected",
            String(selected)
          );
          button.tabIndex = selected ? 0 : -1;
        }
      );
      all("[data-auth-panel]").forEach(
        function (panel) {
          var selected =
            panel.getAttribute(
              "data-auth-panel"
            ) === selectedMode;
          panel.hidden = !selected;
          panel.setAttribute(
            "aria-hidden",
            String(!selected)
          );
        }
      );
    }

    function setStage(name) {
      all("[data-customer-stage]").forEach(
        function (stage) {
          stage.hidden =
            stage.getAttribute(
              "data-customer-stage"
            ) !== name;
        }
      );
      all("[data-customer-progress]").forEach(
        function (item) {
          if (
            item.getAttribute(
              "data-customer-progress"
            ) === name
          ) {
            item.setAttribute(
              "aria-current",
              "step"
            );
          } else {
            item.removeAttribute("aria-current");
          }
        }
      );
    }

    function accountName(account) {
      return text(
        account
        && (
          account.name
          || account.displayName
          || account.email
        )
      ) || "Site Sourcery account";
    }

    function renderProjects(state) {
      var list = one("[data-project-list]");
      if (!list) return;
      list.replaceChildren();
      state.projects.forEach(function (project) {
        var item = documentRef.createElement("li");
        var button =
          documentRef.createElement("button");
        var name =
          documentRef.createElement("strong");
        var detail =
          documentRef.createElement("span");
        button.type = "button";
        name.textContent =
          text(project.name) || "Website project";
        detail.textContent =
          idOf(project) === idOf(state.project)
            ? "Selected"
            : "Open project";
        if (
          idOf(project) === idOf(state.project)
        ) {
          button.setAttribute(
            "aria-current",
            "true"
          );
        }
        button.append(name, detail);
        button.addEventListener(
          "click",
          function () {
            run(
              button,
              function () {
                return control
                  .selectProject(idOf(project))
                  .then(function (selected) {
                    if (!selected) return null;
                    var opened =
                      maker.loadProject(selected);
                    if (!opened) {
                      throw new Error(
                        "The project was selected, but your unsaved preview stayed open."
                      );
                    }
                    var version =
                      acceptedProjectVersion(selected);
                    control.selectVersion(
                      idOf(version)
                    );
                    if (pendingGuestCandidate) {
                      return saveCandidate(
                        pendingGuestCandidate
                      );
                    }
                    return selected;
                  });
              },
              "Project opened."
            );
          }
        );
        item.appendChild(button);
        list.appendChild(item);
      });
    }

    function renderQuote(state) {
      var review =
        one("[data-download-quote-review]");
      var accepted =
        one("[data-accept-download-quote]");
      var continueButton =
        one("[data-continue-download-payment]");
      var view =
        state.downloadQuote
          ? verifiedDownloadQuote(
              state.downloadQuote,
              idOf(state.project),
              state.selectedVersionId,
              Date.now()
            )
          : null;
      activeQuote = view;
      if (!review) return;
      review.hidden = !view;
      if (!view) {
        if (accepted) accepted.checked = false;
        if (continueButton) {
          continueButton.disabled = true;
        }
        return;
      }
      one("[data-download-price]").textContent =
        view.price;
      one("[data-download-project]").textContent =
        text(state.project && state.project.name)
        || "Selected project";
      one("[data-download-version]").textContent =
        "Saved version " + view.versionId;
      one("[data-download-expiry]").textContent =
        new Date(view.expiresAt).toLocaleString();
      one("[data-download-disclosure]")
        .textContent = view.disclosure;
      if (accepted) accepted.checked = false;
      if (continueButton) {
        continueButton.disabled = true;
      }
    }

    function renderCapabilities(state) {
      var createButton =
        one("[data-create-account]");
      var registrationCopy =
        one("[data-registration-availability]");
      createButton.disabled =
        !capabilities.accountRegistration;
      registrationCopy.textContent =
        capabilities.accountRegistration
          ? "Account activation email is ready."
          : "New account email is not open yet. Existing customers can still sign in.";

      var quoteButton =
        one("[data-request-download-quote]");
      var downloadCopy =
        one("[data-download-availability]");
      quoteButton.disabled = !(
        capabilities.downloadQuote
        && state.project
        && state.selectedVersionId
      );
      if (!capabilities.downloadQuote) {
        downloadCopy.textContent =
          "The $5 quote service is not open yet. Nothing can be charged.";
      } else if (
        !state.project
        || !state.selectedVersionId
      ) {
        downloadCopy.textContent =
          "Save and choose a version before requesting the quote.";
      } else if (!capabilities.downloadPayment) {
        downloadCopy.textContent =
          "The exact quote is available for review. Secure payment is not open yet.";
      } else {
        downloadCopy.textContent =
          "The exact quote and secure payment are ready.";
      }
    }

    function render(state) {
      lastState = state;
      var account = state.account;
      var sessionBar = one("[data-session-bar]");
      sessionBar.hidden = !account;
      if (account) {
        one("[data-account-name]").textContent =
          accountName(account);
        one("[data-account-email]").textContent =
          text(account.email);
      }
      renderProjects(state);
      renderQuote(state);
      renderCapabilities(state);

      var entitlement =
        downloadEntitlement(state.project);
      var downloadButton =
        one("[data-download-html]");
      if (entitlement) {
        setStage("download");
        downloadButton.disabled =
          !text(
            entitlement.downloadUrl
            || entitlement.downloadToken
          );
        one("[data-download-ready-copy]")
          .textContent = downloadButton.disabled
            ? "Payment is confirmed. The secure file is still being prepared."
            : "Your project Download is ready.";
      } else if (!account) {
        setStage("account");
      } else if (
        !state.project
        || !state.selectedVersionId
      ) {
        setStage("project");
      } else {
        setStage("quote");
        one("[data-selected-version]")
          .textContent =
            "The exact quote will use saved version "
            + state.selectedVersionId + ".";
      }
    }

    function run(
      button,
      action,
      successMessage
    ) {
      if (button) button.disabled = true;
      announce("Working…");
      return Promise.resolve()
        .then(action)
        .then(function (result) {
          if (
            successMessage
            && result !== null
            && result !== undefined
          ) {
            announce(successMessage, "success");
          }
          return result;
        })
        .catch(function (error) {
          announce(
            explain(
              error,
              "That request could not be completed."
            ),
            "error"
          );
          return null;
        })
        .finally(function () {
          if (button) button.disabled = false;
          render(control.getState());
        });
    }

    function saveCandidate(candidate) {
      if (
        !candidate
        || !lastState.account
        || !lastState.project
      ) return Promise.resolve(null);
      var originDigest = text(
        candidate.result
        && candidate.result.artifactDigest
      );
      return control
        .acceptMadeVersion(candidate)
        .then(function (version) {
          if (
            !bindAcceptedVersion(
              maker,
              originDigest,
              version
            )
          ) {
            throw new Error(
              "That saved version no longer matches the preview in this tab."
            );
          }
          pendingGuestCandidate = null;
          announce(
            "Preview saved to this project.",
            "success"
          );
          return version;
        });
    }

    function flushDraft() {
      if (
        draftSaving
        || !queuedDraft
        || !lastState.project
      ) return;
      var queued = queuedDraft;
      queuedDraft = null;
      if (
        queued.projectId !==
        idOf(lastState.project)
      ) return;
      draftSaving = true;
      control
        .saveDraft(queued.raw)
        .catch(function (error) {
          announce(
            explain(
              error,
              "This draft could not be saved. Your preview is still in this tab."
            ),
            "error"
          );
        })
        .finally(function () {
          draftSaving = false;
          if (queuedDraft) flushDraft();
        });
    }

    all("[data-auth-mode]").forEach(
      function (button) {
        button.addEventListener(
          "click",
          function () {
            setAuthMode(
              button.getAttribute(
                "data-auth-mode"
              )
            );
          }
        );
      }
    );

    one("[data-create-account]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          return control.beginRegistration({
            name: value("accountName"),
            organizationName:
              value("organizationName"),
            email: value("accountEmail"),
            password: value("accountPassword")
          }).then(function (result) {
            var outcome =
              registrationOutcome(result);
            announce(
              outcome.message,
              outcome.activationReady
                ? "success"
                : "error"
            );
            if (outcome.activationReady) {
              setAuthMode("activate");
            }
            return result;
          });
        });
      });

    one("[data-complete-registration]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(
          button,
          function () {
            return control.completeRegistration({
              token: value("activationToken")
            });
          },
          "Account activated."
        );
      });

    one("[data-return-to-create]")
      .addEventListener("click", function () {
        one('[name="activationToken"]').value = "";
        setAuthMode("create");
        announce(
          "Enter the email you want tied to this account."
        );
      });

    one("[data-sign-in]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            return control.signIn({
              email: value("signInEmail"),
              password: value("signInPassword")
            });
          },
          "Signed in."
        );
      });

    one("[data-sign-out]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            pendingGuestCandidate = null;
            return control
              .signOut()
              .then(function () {
                return { signedOut: true };
              });
          },
          "Signed out."
        );
      });

    one("[data-request-recovery]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          return control.requestRecovery({
            email: value("recoveryEmail")
          }).then(function (result) {
            var outcome = recoveryOutcome(result);
            one("[data-recovery-support]").hidden =
              !outcome.supportRequired;
            announce(
              outcome.message,
              outcome.supportRequired
                ? "error"
                : "success"
            );
            return result;
          });
        });
      });

    one("[data-complete-recovery]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            return control.completeRecovery({
              token: value("recoveryToken"),
              password:
                value("recoveryPassword")
            });
          },
          "Password reset. Sign in with the new password."
        ).then(function (result) {
          if (result) setAuthMode("sign-in");
        });
      });

    one("[data-create-project]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          if (
            !one('[name="acceptedProjectTerms"]')
              .checked
          ) {
            throw new Error(
              "Accept the website terms before saving this project."
            );
          }
          return control.createProject({
            name: value("projectName"),
            acceptedTerms: true
          }).then(function (project) {
            if (!project) return null;
            if (pendingGuestCandidate) {
              return saveCandidate(
                pendingGuestCandidate
              );
            }
            return project;
          });
        }, "Project saved.");
      });

    one("[data-request-download-quote]")
      .addEventListener("click", function (event) {
        run(
          event.currentTarget,
          function () {
            return control.quoteDownload();
          },
          "Exact $5 quote ready."
        ).then(function () {
          var review =
            one("[data-download-quote-review]");
          if (!review.hidden) review.focus();
        });
      });

    one("[data-accept-download-quote]")
      .addEventListener("change", function (event) {
      one("[data-continue-download-payment]")
          .disabled = !(
            activeQuote
            && event.currentTarget.checked
            && capabilities.downloadPayment
          );
      });

    one("[data-continue-download-payment]")
      .addEventListener("click", function (event) {
        var button = event.currentTarget;
        run(button, function () {
          if (
            !activeQuote
            || !one(
              "[data-accept-download-quote]"
            ).checked
          ) {
            throw new Error(
              "Review and accept the current $5 quote first."
            );
          }
          return control
            .prepareDownloadCheckout()
            .then(function (result) {
              var destination =
                safeCheckoutDestination(result);
              if (destination) {
                windowRef.location.assign(
                  destination
                );
                return result;
              }
              if (
                result
                && result.dispatchAuthorized ===
                  false
              ) {
                throw new Error(
                  "Secure payment is not open in this build. Nothing was charged."
                );
              }
              throw new Error(
                "The secure payment page was not verified. Nothing was charged."
              );
            });
        });
      });

    one("[data-download-html]")
      .addEventListener("click", function () {
        announce(
          "The secure HTML file is not ready yet.",
          "error"
        );
      });

    windowRef.addEventListener(
      "abracadabra:draftchange",
      function (event) {
        if (!lastState.project) return;
        windowRef.clearTimeout(draftTimer);
        queuedDraft = {
          projectId: idOf(lastState.project),
          raw:
            event.detail && event.detail.raw
              ? event.detail.raw
              : maker.getDraft()
        };
        draftTimer = windowRef.setTimeout(
          flushDraft,
          350
        );
      }
    );

    windowRef.addEventListener(
      "abracadabra:versionmade",
      function (event) {
        if (!event.detail) return;
        pendingGuestCandidate =
          clone(event.detail);
        if (
          !lastState.account
          || !lastState.project
        ) {
          announce(
            "Preview ready. Create an account or sign in only when you want to save it.",
            "success"
          );
          return;
        }
        saveCandidate(pendingGuestCandidate)
          .catch(function (error) {
            announce(
              explain(
                error,
                "That version could not be saved."
              ),
              "error"
            );
          });
      }
    );

    windowRef.addEventListener(
      "abracadabra:versionselected",
      function (event) {
        control.selectVersion(
          event.detail
          && event.detail.platformVersionId
        );
      }
    );

    one("[data-save-direction]")
      .addEventListener("click", function () {
        revealControlRoom(
          lastState.account
            ? null
            : "create"
        );
        announce(
          lastState.account
            ? "Choose or create a project for this preview."
            : "Create an account or sign in to save this preview."
        );
      });

    var openAccount =
      one("[data-open-account]");
    if (openAccount) {
      openAccount.disabled = false;
      openAccount.addEventListener(
        "click",
        function () {
          revealControlRoom(
            lastState.account
              ? null
              : "sign-in"
          );
          announce(
            lastState.account
              ? "Your account is open."
              : "Sign in to your Site Sourcery account."
          );
        }
      );
    }

    if (activationToken) {
      one('[name="activationToken"]').value =
        activationToken;
      setAuthMode("activate");
      revealControlRoom("activate");
      announce(
        "Activation link opened. Select Activate account to finish."
      );
    } else if (recoveryToken) {
      one('[name="recoveryToken"]').value =
        recoveryToken;
      one("[data-recovery-complete]").hidden =
        false;
      setAuthMode("recover");
      revealControlRoom("recover");
      announce(
        "Recovery link opened. Choose a new password."
      );
    } else {
      setAuthMode("create");
    }

    control.subscribe(render);
    controlRoom.setAttribute(
      "data-control-ready",
      "hosted"
    );
    documentRef.documentElement.setAttribute(
      "data-abracadabra-control-ready",
      "hosted"
    );
    announce("Opening your account…");
    var capabilityRequest =
      typeof client.capabilities === "function"
        ? client.capabilities()
            .then(function (result) {
              var source =
                result
                && typeof result === "object"
                  ? result
                  : {};
              capabilities = Object.freeze({
                accountRegistration:
                  source.accountRegistration ===
                  true,
                accountRecoveryEmail:
                  source.accountRecoveryEmail ===
                  true,
                downloadQuote:
                  source.downloadQuote === true,
                downloadPayment:
                  source.downloadPayment === true,
                domainPurchase:
                  source.domainPurchase === true,
                publishing:
                  source.publishing === true
              });
              render(control.getState());
              return capabilities;
            })
            .catch(function () {
              render(control.getState());
              return capabilities;
            })
        : Promise.resolve(capabilities);
    Promise.all([
      capabilityRequest,
      control.boot()
    ])
      .then(function () {
        if (control.getState().account) {
          announce("Account ready.", "success");
        } else if (!activationToken && !recoveryToken) {
          announce(
            "Your free preview is ready. Sign in only when you want to save it."
          );
        }
      })
      .catch(function (error) {
        announce(
          explain(
            error,
            "Your account could not open. Your free preview still works."
          ),
          "error"
        );
      });
    return true;
  }

  return Object.freeze({
    acceptedProjectVersion:
      acceptedProjectVersion,
    bindAcceptedVersion: bindAcceptedVersion,
    boot: boot,
    recoveryOutcome: recoveryOutcome,
    recoveryTokenFromLocation:
      recoveryTokenFromLocation,
    registrationOutcome:
      registrationOutcome,
    registrationTokenFromLocation:
      registrationTokenFromLocation,
    safeCheckoutDestination:
      safeCheckoutDestination,
    verifiedDownloadQuote:
      verifiedDownloadQuote
  });
}));
