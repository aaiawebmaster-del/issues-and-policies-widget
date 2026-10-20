/**
 * GA layout hotfix (card-v5) — runtime override when Sitefinity still serves old templates.
 * List: force 3-col grid + hide Grid/List toggle.
 * Detail: wrap Issue/Position/Impact + map into 50/50 .ga-detail-split.
 * Load: <script src="https://ga-policy-note.netlify.app/ga-layout-hotfix.js" defer></script>
 */
(function () {
  if (window.__gaLayoutHotfixV1) return;
  window.__gaLayoutHotfixV1 = true;

  var STYLE_ID = "ga-layout-hotfix-v1-style";
  var MARK = "data-ga-hotfix";

  function ensureCss() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      "html body #gaWidgetRoot .ga-issues-view-toggle { display: none !important; }",
      "html body #gaWidgetRoot #gaIssuesStack.is-grid,",
      "html body #gaWidgetRoot .ga-issues-stack.is-grid {",
      "  display: grid !important;",
      "  grid-template-columns: repeat(3, minmax(0, 1fr)) !important;",
      "  gap: 1.15rem !important;",
      "  width: 100% !important;",
      "  align-items: stretch !important;",
      "  flex-flow: unset !important;",
      "}",
      "html body #gaWidgetRoot #gaIssuesStack.is-grid > .ga-issue-block,",
      "html body #gaWidgetRoot .ga-issues-stack.is-grid > .ga-issue-block {",
      "  flex: none !important;",
      "  width: auto !important;",
      "  max-width: none !important;",
      "  min-width: 0 !important;",
      "  height: 100% !important;",
      "  margin: 0 !important;",
      "  float: none !important;",
      "  box-sizing: border-box !important;",
      "}",
      "@media (max-width: 899px) {",
      "  html body #gaWidgetRoot #gaIssuesStack.is-grid,",
      "  html body #gaWidgetRoot .ga-issues-stack.is-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }",
      "}",
      "@media (max-width: 599px) {",
      "  html body #gaWidgetRoot #gaIssuesStack.is-grid,",
      "  html body #gaWidgetRoot .ga-issues-stack.is-grid { grid-template-columns: minmax(0, 1fr) !important; }",
      "}",
      "html body .ga-detail .ga-detail-split {",
      "  display: grid !important;",
      "  grid-template-columns: minmax(0, 1fr) !important;",
      "  gap: 1.25rem !important;",
      "  align-items: start !important;",
      "  width: 100% !important;",
      "}",
      "@media (min-width: 768px) {",
      "  html body .ga-detail .ga-detail-split {",
      "    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;",
      "  }",
      "}",
      "html body .ga-detail .ga-detail-copy {",
      "  display: flex !important;",
      "  flex-direction: column !important;",
      "  gap: 1rem !important;",
      "  min-width: 0 !important;",
      "}",
      "html body .ga-detail .ga-detail-split > .ga-policy-map__panel,",
      "html body .ga-detail .ga-detail-split > .ga-policy-map {",
      "  min-width: 0 !important;",
      "}"
    ].join("\n");
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.setAttribute(MARK, "card-v5");
    style.textContent = css;
    document.documentElement.appendChild(style);
  }

  function fixListLayout() {
    var root = document.getElementById("gaWidgetRoot");
    if (!root) return null;
    root.setAttribute(MARK, "card-v5");
    ensureCss();

    var stack = document.getElementById("gaIssuesStack") || root.querySelector(".ga-issues-stack");
    if (stack) {
      stack.classList.add("is-grid");
      stack.classList.remove("is-list");
      try {
        stack.style.setProperty("display", "grid", "important");
        stack.style.setProperty("grid-template-columns", "repeat(3, minmax(0, 1fr))", "important");
        stack.style.removeProperty("flex-flow");
        stack.style.removeProperty("flex-wrap");
      } catch (e) {}
    }

    var toggle = root.querySelector(".ga-issues-view-toggle");
    if (toggle) toggle.hidden = true;

    var cs = stack ? getComputedStyle(stack) : null;
    var result = {
      hasRoot: true,
      display: cs && cs.display,
      cols: cs && cs.gridTemplateColumns,
      toggleHidden: !toggle || toggle.hidden || (toggle && getComputedStyle(toggle).display === "none")
    };
    return result;
  }

  function isIssueSection(el) {
    var h = el && el.querySelector && el.querySelector("h2");
    var t = h ? (h.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() : "";
    return t === "issue" || t === "our position" || t === "position" || t === "impact";
  }

  function hideAtAGlanceOnIssues() {
    var detail = document.querySelector(".ga-detail");
    if (!detail) return;
    var kind = (detail.getAttribute("data-ga-kind") || "").toLowerCase();
    var isIssue = detail.classList.contains("ga-detail--issue") || kind === "issue";
    if (!isIssue) {
      // Heuristic: Issue pages have Issue/Position/Impact sections
      var main = detail.querySelector(".ga-detail-main");
      var hits = main ? Array.prototype.filter.call(main.children, isIssueSection).length : 0;
      isIssue = hits >= 2;
    }
    if (!isIssue) return;
    detail.classList.add("ga-detail--issue");
    Array.prototype.forEach.call(detail.querySelectorAll("h2"), function (h) {
      if (!/at a glance/i.test(h.textContent || "")) return;
      var section = h.closest(".ga-detail-section, section, .ga-detail-panel, aside");
      if (section) section.hidden = true;
    });
  }

  function fixDetailSplit() {
    var detail = document.querySelector(".ga-detail");
    var main = document.querySelector(".ga-detail-main");
    if (!detail || !main) return null;
    if (detail.querySelector(".ga-detail-split")) {
      ensureCss();
      hideAtAGlanceOnIssues();
      return { already: true };
    }

    var map = main.querySelector("#gaPolicyMapRoot, .ga-policy-map");
    var copySections = Array.prototype.filter.call(main.children, function (el) {
      return el !== map && isIssueSection(el);
    });
    if (!map || copySections.length < 2) {
      return null;
    }

    ensureCss();
    var split = document.createElement("div");
    split.className = "ga-detail-split";
    split.setAttribute(MARK, "card-v5");
    var copy = document.createElement("div");
    copy.className = "ga-detail-copy";
    copySections.forEach(function (el) { copy.appendChild(el); });

    // Prefer map panel column: if map contains an inner panel, use outer map as column
    var mapCol = map;
    split.appendChild(copy);
    split.appendChild(mapCol);
    main.insertBefore(split, main.firstChild);

    hideAtAGlanceOnIssues();

    var cs = getComputedStyle(split);
    var result = {
      created: true,
      display: cs.display,
      cols: cs.gridTemplateColumns,
      copyKids: copy.children.length
    };
    return result;
  }

  function fixIssueDetailsCtas() {
    var root = document.getElementById("gaWidgetRoot");
    if (!root) return null;
    var stack = document.getElementById("gaIssuesStack") || root.querySelector(".ga-issues-stack");
    if (!stack) return null;

    var btns = stack.querySelectorAll("button.ga-issue-block__cta[data-ga-open], .ga-issue-block__cta[data-ga-open]");
    var fixed = 0;
    Array.prototype.forEach.call(btns, function (btn) {
      if (btn.getAttribute(MARK) === "details-link") return;
      var openId = btn.getAttribute("data-ga-open") || "";
      var row = openId ? document.getElementById("ga-row-" + openId) : null;
      if (!row && openId) {
        row = root.querySelector('[data-open-id="' + openId.replace(/"/g, "") + '"]');
      }
      var url = row && (row.getAttribute("data-detail-url") || row.getAttribute("data-learn-more-url") || "");
      if (!url) return;

      var a = document.createElement("a");
      a.className = btn.className;
      a.href = url;
      a.textContent = ((btn.textContent || "Details").trim()) || "Details";
      a.setAttribute(MARK, "details-link");
      btn.parentNode.replaceChild(a, btn);
      fixed += 1;
    });
    return { fixed: fixed };
  }

  function run() {
    fixListLayout();
    fixIssueDetailsCtas();
    fixDetailSplit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }

  // Re-apply when Sitefinity widget JS rebuilds the issues stack
  try {
    var moTarget = document.getElementById("gaWidgetRoot") || document.querySelector(".ga-detail-main");
    if (moTarget && window.MutationObserver) {
      var scheduled = false;
      var mo = new MutationObserver(function () {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          run();
        });
      });
      mo.observe(moTarget, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    }
  } catch (e) {}
})();
