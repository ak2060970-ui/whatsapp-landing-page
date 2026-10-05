(function () {
  "use strict";

  /* -----------------------------------------------------------
     TODO before going live:
     1. Swap the remaining testimonial media-placeholder blocks
        (6 video slots) with real attendee testimonial videos/photos.
     ----------------------------------------------------------- */

  var REGISTRATION_ENDPOINT =
    "https://script.google.com/macros/s/AKfycbxQZaId1RmptK6aSgvtsVN5riKUpDjzRbo_3HH-oqbqIUXDxqUITNCHFQrSmNXI6OA/exec?gid=0";
  var FINBITE_WEBHOOK_ENDPOINT =
    "https://app.finbite.in/api/v2/webhook/flows/6a9a476c1a8a6fa9b6452e0e";
  var N8N_WEBHOOK_ENDPOINT =
    "https://n8n.finbite.in/webhook/ad49a705-ea81-417b-a5ab-956964d28b6f";

  var modal = document.querySelector(".js-modal");
  var openBtns = document.querySelectorAll(".js-open-modal");
  var closeBtns = document.querySelectorAll(".js-close-modal");
  var form = document.querySelector(".js-reg-form");
  var stickyCta = document.querySelector(".js-sticky-cta");
  var hero = document.querySelector(".hero");
  var yearEl = document.getElementById("js-year");

  if (yearEl) yearEl.textContent = new Date().getFullYear();

  function openModal() {
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    resetRegForm();
  }

  // Country-code dropdown (searchable) on the WhatsApp number field,
  // defaulting to India. Falls back to a plain input if the library
  // script failed to load.
  var whatsappInput = document.getElementById("whatsapp-input");
  var iti = null;
  if (whatsappInput && window.intlTelInput) {
    iti = window.intlTelInput(whatsappInput, {
      initialCountry: "in",
      separateDialCode: true,
      utilsScript:
        "https://cdn.jsdelivr.net/npm/intl-tel-input@23.8.0/build/js/utils.js",
    });
  }

  openBtns.forEach(function (btn) {
    btn.addEventListener("click", openModal);
  });
  closeBtns.forEach(function (btn) {
    btn.addEventListener("click", closeModal);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  // POSTs `data` to `url` and resolves once it settles OR once timeoutMs
  // elapses, whichever comes first — so one slow/dead endpoint can't hang
  // the page forever. keepalive lets the request keep going in the
  // background on the rare case we give up waiting on it and navigate
  // away first (note: navigator.sendBeacon is NOT used here — it forces
  // credentials:"include" on every request, and since these third-party
  // webhooks don't send back Access-Control-Allow-Credentials, the browser
  // blocks it via CORS outright, which is worse than fetch).
  function postWithTimeout(url, data, isJson, timeoutMs) {
    var req = fetch(url, {
      method: "POST",
      headers: isJson ? { "Content-Type": "application/json" } : undefined,
      body: isJson ? JSON.stringify(data) : new URLSearchParams(data),
      keepalive: true,
    }).catch(function (err) {
      console.error("Request to " + url + " failed:", err);
    });
    return Promise.race([
      req,
      new Promise(function (resolve) {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  var submitBtn = form ? form.querySelector(".reg-form__submit") : null;
  var submitText = form ? form.querySelector(".reg-form__submit-text") : null;
  var submitDots = form ? form.querySelector(".reg-form__submit-dots") : null;
  var regSteps = form ? form.querySelectorAll(".reg-form__step[data-step]") : [];

  // Shows the step whose data-step matches `stepValue` ("0"-"4") and
  // hides every other one.
  function showRegStep(stepValue) {
    regSteps.forEach(function (stepEl) {
      stepEl.hidden = stepEl.getAttribute("data-step") !== stepValue;
    });
  }

  // The form has novalidate (native validation would fire on hidden
  // earlier/later steps too), so each step's required fields are checked
  // by hand before we let the user move forward.
  function stepIsValid(stepEl) {
    var invalid = stepEl.querySelector(":invalid");
    if (invalid) {
      invalid.reportValidity();
      return false;
    }
    return true;
  }

  // A qualifying question is answered with one of the options flagged
  // data-disqualify="true" (Student, Less than 20, Just exploring, etc.)
  function stepIsDisqualifying(stepEl) {
    var checked = stepEl.querySelector('input[type="radio"]:checked');
    return !!(checked && checked.dataset.disqualify === "true");
  }

  function resetRegForm() {
    if (!form) return;
    form.reset();
    showRegStep("0");
    if (submitBtn) submitBtn.disabled = false;
    if (submitText) submitText.hidden = false;
    if (submitDots) submitDots.hidden = true;
  }

  // "DD/MM/YYYY HH:MM:SSAM/PM" in IST, e.g. "26/09/2026 11:23:00PM" —
  // used only for the Sheet's Date column.
  function formatISTTimestamp() {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).formatToParts(new Date());
    var v = {};
    parts.forEach(function (p) {
      v[p.type] = p.value;
    });
    var hour = v.hour === "24" ? "12" : v.hour;
    var ampm = (v.dayPeriod || "").toUpperCase();
    return (
      v.day + "/" + v.month + "/" + v.year + " " +
      hour + ":" + v.minute + ":" + v.second + ampm
    );
  }

  // Name/Mobile/Email/Industry only. These go to the Sheet and to
  // Finbite/n8n as-is.
  function buildLeadData() {
    var mobileDigits = iti
      ? iti.getNumber().replace(/^\+/, "")
      : form.whatsapp.value.replace(/\D/g, "");
    return {
      Name: form.name.value.trim(),
      Mobile: mobileDigits,
      Email: form.email.value.trim(),
      Industry: form.industry.value.trim(),
    };
  }

  // The 4 qualifying question answers (Q1-Q4) — Sheet-only, never sent
  // to Finbite/n8n. A disqualified lead may not have reached every
  // question, so unanswered ones come back blank.
  function buildAnswers() {
    function answerFor(name) {
      var checked = form.querySelector('input[name="' + name + '"]:checked');
      return checked ? checked.value : "";
    }
    return {
      Q1: answerFor("persona"),
      Q2: answerFor("volume"),
      Q3: answerFor("goal"),
      Q4: answerFor("challenge"),
    };
  }

  // Disqualified leads still get one row in the Google Sheet (contact
  // info + Status: "Disqualified") so nothing's lost, but they never
  // reach the Finbite/n8n webhooks — those trigger real WhatsApp
  // automation flows that should only fire for qualified leads.
  //
  // Uses sendBeacon rather than postWithTimeout: this write is a plain
  // form-urlencoded POST (no custom headers), so — unlike the JSON
  // webhook calls elsewhere in this file — it doesn't need a CORS
  // preflight, and sendBeacon's forced credentials:"include" doesn't
  // block it. sendBeacon hands the request to the browser to deliver in
  // the background, which is reliable even though we navigate away
  // immediately after — no timeout race, no dependency on keepalive
  // fetch (which some mobile browsers don't honor consistently).
  function recordDisqualifiedAndRedirect() {
    var sheetData = Object.assign({}, buildLeadData(), buildAnswers(), {
      Status: "Disqualified",
      Date: formatISTTimestamp(),
    });
    var queued =
      navigator.sendBeacon &&
      navigator.sendBeacon(REGISTRATION_ENDPOINT, new URLSearchParams(sheetData));
    if (queued) {
      window.location.href = "thanks-info/";
      return;
    }
    postWithTimeout(REGISTRATION_ENDPOINT, sheetData, false, 2500).then(
      function () {
        window.location.href = "thanks-info/";
      }
    );
  }

  form &&
    form.querySelectorAll(".js-reg-next").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var stepEl = btn.closest(".reg-form__step");
        if (!stepIsValid(stepEl)) return;
        if (stepIsDisqualifying(stepEl)) {
          recordDisqualifiedAndRedirect();
          return;
        }
        showRegStep(btn.getAttribute("data-next"));
      });
    });

  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var lastStep = form.querySelector('.reg-form__step[data-step="4"]');
      if (!stepIsValid(lastStep)) return;
      if (stepIsDisqualifying(lastStep)) {
        recordDisqualifiedAndRedirect();
        return;
      }

      // leadData goes to Finbite/n8n as-is; the Sheet gets the same
      // fields plus Status/Date/Q1-Q4 so Qualified/Disqualified leads
      // both show up there with their answers.
      var leadData = buildLeadData();
      var sheetData = Object.assign({}, leadData, buildAnswers(), {
        Status: "Qualified",
        Date: formatISTTimestamp(),
      });

      // Show a 3-dot loading state while these integrations run, then
      // navigate. Each call gets up to 2.5s to actually complete before
      // we give up waiting on it — this is what makes delivery reliable
      // (a fire-and-forget call can get cut short by the redirect), while
      // the 2.5s cap plus 800ms floor keeps the wait short in the normal
      // case where these all respond quickly.
      if (submitBtn) submitBtn.disabled = true;
      if (submitText) submitText.hidden = true;
      if (submitDots) submitDots.hidden = false;

      var sheetWrite = postWithTimeout(REGISTRATION_ENDPOINT, sheetData, false, 2500);
      var finbiteWebhook = postWithTimeout(FINBITE_WEBHOOK_ENDPOINT, leadData, true, 2500);
      var n8nWebhook = postWithTimeout(N8N_WEBHOOK_ENDPOINT, leadData, true, 2500);
      var minDelay = new Promise(function (resolve) {
        setTimeout(resolve, 800);
      });

      Promise.all([sheetWrite, finbiteWebhook, n8nWebhook, minDelay]).then(
        function () {
          window.location.href = "thank-you-webinar-whatsapp/";
        }
      );
    });
  }

  // Sticky mobile CTA — visible by default (CSS), hidden only while the
  // hero (which has its own CTA) is still on screen. If this JS never
  // runs, the bar stays visible rather than stuck hidden.
  if (stickyCta && hero) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            stickyCta.classList.add("is-hidden");
          } else {
            stickyCta.classList.remove("is-hidden");
          }
        });
      },
      { threshold: 0 }
    );
    io.observe(hero);
  }
})();
