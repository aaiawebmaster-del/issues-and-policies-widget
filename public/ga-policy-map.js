/**
 * Government Affairs — related policies US map (R2R-style).
 * Expects window.GA_POLICY_MAP_DATA = { policies: [...], apiBase?: string, proxyKey?: string }
 * Mount: #gaPolicyMapRoot
 */
(function () {
  'use strict';

  // Pull in list/detail layout hotfix when only the map script is loaded on detail pages.
  if (!window.__gaLayoutHotfixV1) {
    var hs = document.createElement('script');
    hs.src = 'https://ga-policy-note.netlify.app/ga-layout-hotfix.js';
    hs.async = true;
    document.head.appendChild(hs);
  }

  var STATE_NAME_TO_KEY = {
    Alabama: 'us-al', Alaska: 'us-ak', Arizona: 'us-az', Arkansas: 'us-ar', California: 'us-ca',
    Colorado: 'us-co', Connecticut: 'us-ct', Delaware: 'us-de', 'District of Columbia': 'us-dc',
    Florida: 'us-fl', Georgia: 'us-ga', Hawaii: 'us-hi', Idaho: 'us-id', Illinois: 'us-il',
    Indiana: 'us-in', Iowa: 'us-ia', Kansas: 'us-ks', Kentucky: 'us-ky', Louisiana: 'us-la',
    Maine: 'us-me', Maryland: 'us-md', Massachusetts: 'us-ma', Michigan: 'us-mi', Minnesota: 'us-mn',
    Mississippi: 'us-ms', Missouri: 'us-mo', Montana: 'us-mt', Nebraska: 'us-ne', Nevada: 'us-nv',
    'New Hampshire': 'us-nh', 'New Jersey': 'us-nj', 'New Mexico': 'us-nm', 'New York': 'us-ny',
    'North Carolina': 'us-nc', 'North Dakota': 'us-nd', Ohio: 'us-oh', Oklahoma: 'us-ok', Oregon: 'us-or',
    Pennsylvania: 'us-pa', 'Rhode Island': 'us-ri', 'South Carolina': 'us-sc', 'South Dakota': 'us-sd',
    Tennessee: 'us-tn', Texas: 'us-tx', Utah: 'us-ut', Vermont: 'us-vt', Virginia: 'us-va',
    Washington: 'us-wa', 'West Virginia': 'us-wv', Wisconsin: 'us-wi', Wyoming: 'us-wy'
  };

  var ACTIVE_COLOR = '#F3901D';
  var FEDERAL_COLOR = '#1C3664';
  var INACTIVE_COLOR = '#C8D0D9';
  var MAP_URL = 'https://cdn.jsdelivr.net/npm/@highcharts/map-collection@2.3.0/countries/us/us-all.topo.json';
  var MAP_URL_FALLBACK = 'https://code.highcharts.com/mapdata/countries/us/us-all.topo.json';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    try {
      var url = new URL(raw, window.location.origin);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (e) {}
    return '';
  }

  function resolveState(raw) {
    var text = String(raw || '').trim();
    if (!text) return '';
    if (STATE_NAME_TO_KEY[text]) return text;
    var lower = text.toLowerCase();
    var name;
    for (name in STATE_NAME_TO_KEY) {
      if (name.toLowerCase() === lower) return name;
    }
    if (/^[a-z]{2}$/i.test(text)) {
      var abbr = text.toLowerCase();
      for (name in STATE_NAME_TO_KEY) {
        if (STATE_NAME_TO_KEY[name] === 'us-' + abbr) return name;
      }
    }
    return '';
  }

  function isFederalPolicy(p) {
    var j = String(p.jurisdiction || '').toLowerCase();
    if (j === 'national' || j === 'federal') return true;
    var label = String(p.jurisdictionLabel || '').toLowerCase();
    if (label.indexOf('national') >= 0 || label.indexOf('federal') >= 0) return true;
    var region = String(p.region || p.state || '').trim().toLowerCase();
    if (region === 'national' || region === 'federal' || region === 'united states' || region === 'u.s.' || region === 'us') {
      return true;
    }
    return false;
  }

  function statusClass(statusKey) {
    var key = String(statusKey || '').toLowerCase();
    if (key === 'enacted' || key === 'passed-both') return 'enacted';
    if (key === 'failed') return 'failed';
    if (key === 'in-committee') return 'in-committee';
    if (key === 'on-floor' || key === 'passed-one') return 'active';
    return 'introduced';
  }

  function statusBadgeClass(p) {
    if (p.statusClass) return p.statusClass;
    var key = String(p.statusKey || '').toLowerCase();
    if (key === 'enacted' || key === 'passed-both') return 'is-enacted';
    if (key === 'failed') return 'is-failed';
    return '';
  }

  function jurisdictionIcon(p) {
    if (p.jurisdictionIcon) return p.jurisdictionIcon;
    var j = String(p.jurisdiction || '').toLowerCase();
    if (j === 'national') return 'fa-solid fa-flag-usa';
    if (j === 'state') return 'fa-solid fa-map-location-dot';
    if (j === 'international') return 'fa-solid fa-globe';
    return 'fa-solid fa-location-dot';
  }

  function normalizePolicy(p) {
    var federal = isFederalPolicy(p);
    var state = federal ? '' : resolveState(p.state || p.region || '');
    return {
      title: p.title || 'Policy',
      billNumber: p.billNumber || '',
      status: p.status || '',
      statusKey: p.statusKey || '',
      statusClass: statusBadgeClass(p),
      jurisdiction: p.jurisdiction || (federal ? 'national' : (state ? 'state' : '')),
      jurisdictionLabel: p.jurisdictionLabel || (federal ? 'National' : (state ? 'State/Regional' : '')),
      jurisdictionIcon: jurisdictionIcon(p),
      blurb: p.blurb || '',
      ctaUrl: safeUrl(p.ctaUrl || ''),
      url: safeUrl(p.url || ''),
      officialUrl: safeUrl(p.officialUrl || p.policyPageUrl || ''),
      state: state,
      region: p.region || p.state || '',
      isFederal: federal,
      kind: (p.kind || 'legislation').toLowerCase()
    };
  }

  function init(config) {
    var root = document.getElementById('gaPolicyMapRoot');
    if (!root || typeof Highcharts === 'undefined') return;

    var policies = ((config && config.policies) || []).map(normalizePolicy);
    var statusNode = root.querySelector('[data-ga-map-status]');
    var mapEl = root.querySelector('[data-ga-map-chart]');
    var listEl = root.querySelector('[data-ga-map-list]');
    var filterEl = root.querySelector('[data-ga-map-filters]');
    var dialog = root.querySelector('[data-ga-map-dialog]');
    var dialogTitle = root.querySelector('[data-ga-map-dialog-title]');
    var dialogBody = root.querySelector('[data-ga-map-dialog-body]');
    var dialogClose = root.querySelector('[data-ga-map-dialog-close]');
    var federalLegend = root.querySelector('[data-ga-map-federal-legend]');
    var federalBtn = root.querySelector('[data-ga-map-federal-btn]');

    // Destroy any previous chart instance on this container (preview re-inits on view switch)
    if (mapEl && window.Highcharts && Highcharts.charts) {
      Highcharts.charts.forEach(function (c) {
        if (c && c.renderTo === mapEl) {
          try { c.destroy(); } catch (e) {}
        }
      });
      mapEl.innerHTML = '';
    }

    var activeStatus = 'all';
    var policiesByState = {};
    var federalPolicies = [];
    var chart = null;

    function setStatus(msg) {
      if (statusNode) statusNode.textContent = msg || '';
    }

    function groupPolicies() {
      policiesByState = {};
      federalPolicies = [];
      policies.forEach(function (p) {
        if (p.isFederal) {
          federalPolicies.push(p);
          return;
        }
        if (!p.state) return;
        if (!policiesByState[p.state]) policiesByState[p.state] = [];
        policiesByState[p.state].push(p);
      });
    }

    function extraFilterState() {
      var search = root.querySelector('[data-ga-map-search]');
      var jurOn = root.querySelector('[data-ga-map-jur] .is-on');
      var kindOn = root.querySelector('[data-ga-map-kind] .is-on');
      return {
        query: search && search.value ? String(search.value).toLowerCase().trim() : '',
        jurisdiction: jurOn ? (jurOn.getAttribute('data-ga-jur') || '') : '',
        kind: kindOn ? (kindOn.getAttribute('data-ga-kind') || '') : ''
      };
    }

    function matchesExtra(p, extra) {
      if (extra.query) {
        var hay = ((p.title || '') + ' ' + (p.billNumber || '') + ' ' + (p.state || '') + ' ' +
          (p.region || '') + ' ' + (p.blurb || '')).toLowerCase();
        if (hay.indexOf(extra.query) === -1) return false;
      }
      var jurisdiction = (p.jurisdiction || '').toLowerCase();
      if (extra.jurisdiction === 'federal' && jurisdiction !== 'national') return false;
      if (extra.jurisdiction === 'local' && jurisdiction !== 'state') return false;
      var kind = (p.kind || 'legislation').toLowerCase();
      if (extra.kind === 'legislation' && kind !== 'legislation' && kind !== 'executive-order') return false;
      if (extra.kind === 'regulation' && kind !== 'regulation') return false;
      return true;
    }

    function filteredList(list) {
      var extra = extraFilterState();
      return list.filter(function (p) {
        if (activeStatus !== 'all' && p.statusKey !== activeStatus) return false;
        return matchesExtra(p, extra);
      });
    }

    function buildMapData() {
      return Object.keys(STATE_NAME_TO_KEY).map(function (stateName) {
        var list = filteredList(policiesByState[stateName] || []);
        return {
          'hc-key': STATE_NAME_TO_KEY[stateName],
          name: stateName,
          value: list.length,
          policyCount: list.length,
          color: list.length > 0 ? ACTIVE_COLOR : INACTIVE_COLOR
        };
      });
    }

    function buildFederalPoints() {
      var list = filteredList(federalPolicies);
      if (!list.length) return [];
      return [{
        name: 'Federal / National',
        lat: 38.9072,
        lon: -77.0369,
        policyCount: list.length,
        color: FEDERAL_COLOR,
        marker: {
          radius: 9,
          fillColor: FEDERAL_COLOR,
          lineColor: '#ffffff',
          lineWidth: 2,
          symbol: 'circle'
        }
      }];
    }

    function uniqueStatuses() {
      var map = {};
      policies.forEach(function (p) {
        if (p.statusKey && p.status) map[p.statusKey] = p.status;
      });
      return Object.keys(map).map(function (k) { return { key: k, label: map[k] }; });
    }

    function renderFilters() {
      if (!filterEl) return;
      var statuses = uniqueStatuses();
      var html = '<button type="button" class="ga-policy-map__filter' +
        (activeStatus === 'all' ? ' is-active' : '') +
        '" data-status="all">All</button>';
      statuses.forEach(function (s) {
        html += '<button type="button" class="ga-policy-map__filter' +
          (activeStatus === s.key ? ' is-active' : '') +
          '" data-status="' + escapeHtml(s.key) + '">' + escapeHtml(s.label) + '</button>';
      });
      filterEl.innerHTML = html;
    }

    function visiblePolicies() {
      return filteredList(policies);
    }

    function renderPolicyCard(p) {
      var detailHref = safeUrl(p.url || p.officialUrl);
      var ctaHref = safeUrl(p.ctaUrl);
      var titleHtml = detailHref
        ? '<a href="' + escapeHtml(detailHref) + '">' + escapeHtml(p.title) + '</a>'
        : escapeHtml(p.title);

      var badges = '<div class="ga-row-badges">' +
        '<span class="ga-kind"><i class="fa-solid fa-scroll ga-icon" aria-hidden="true"></i>Policy</span>';
      if (p.status) {
        badges += '<span class="ga-status ' + escapeHtml(p.statusClass || '') +
          '"><i class="fa-solid fa-gavel ga-icon" aria-hidden="true"></i>' +
          escapeHtml(p.status) + '</span>';
      }
      if (p.jurisdictionLabel) {
        badges += '<span class="ga-jurisdiction"><i class="' + escapeHtml(p.jurisdictionIcon) +
          ' ga-icon" aria-hidden="true"></i>' + escapeHtml(p.jurisdictionLabel) + '</span>';
      }
      badges += '</div>';

      var metaParts = [];
      if (p.billNumber) {
        metaParts.push('<span><i class="fa-solid fa-file-lines ga-icon" aria-hidden="true"></i>' +
          escapeHtml(p.billNumber) + '</span>');
      }
      if (p.state) {
        metaParts.push('<span><i class="fa-solid fa-map-pin ga-icon" aria-hidden="true"></i>' +
          escapeHtml(p.state) + '</span>');
      } else if (p.isFederal) {
        metaParts.push('<span><i class="fa-solid fa-landmark ga-icon" aria-hidden="true"></i>Federal</span>');
      }

      var actions = '<div class="ga-row-actions">';
      if (ctaHref) {
        actions += '<a class="btn btn-primary" href="' + escapeHtml(ctaHref) +
          '" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-bullhorn" aria-hidden="true"></i> Take action</a>';
      }
      if (detailHref) {
        actions += '<a class="btn btn-ghost" href="' + escapeHtml(detailHref) +
          '"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Details</a>';
      } else if (p.officialUrl) {
        actions += '<a class="btn btn-ghost" href="' + escapeHtml(p.officialUrl) +
          '" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> Details</a>';
      }
      actions += '</div>';

      return '<article class="ga-row ga-item--policy">' +
        '<div class="ga-row-main">' +
        badges +
        '<h3 class="ga-row-title">' + titleHtml + '</h3>' +
        (metaParts.length ? '<p class="ga-row-meta">' + metaParts.join(' · ') + '</p>' : '') +
        (p.blurb ? '<p class="ga-blurb">' + escapeHtml(p.blurb) + '</p>' : '') +
        '</div>' +
        actions +
        '</article>';
    }

    function renderList() {
      if (!listEl) return;
      var items = visiblePolicies();
      if (!items.length) {
        listEl.innerHTML = '<p class="ga-policy-map__empty">No related policies match this filter.</p>';
        return;
      }
      listEl.innerHTML = items.map(renderPolicyCard).join('');
    }

    function openPolicyDialog(title, list) {
      if (!dialog || !dialogTitle || !dialogBody) return;
      dialogTitle.textContent = title;
      if (!list.length) {
        dialogBody.innerHTML = '<p class="ga-policy-map__empty">No policies for this selection.</p>';
      } else {
        dialogBody.innerHTML = list.map(function (p) {
          var link = p.officialUrl || p.url;
          return '<div class="ga-policy-map__bill">' +
            (p.billNumber ? '<p class="ga-policy-map__bill-number">' + escapeHtml(p.billNumber) + '</p>' : '') +
            '<p class="ga-policy-map__bill-title">' + escapeHtml(p.title) + '</p>' +
            (p.status ? '<p><span class="ga-policy-map__chip ga-policy-map__chip--' +
              statusClass(p.statusKey) + '">' + escapeHtml(p.status) + '</span></p>' : '') +
            (link ? '<p><a class="btn btn-primary" href="' + escapeHtml(link) +
              '" target="_blank" rel="noopener noreferrer">View bill</a></p>' : '') +
            '</div>';
        }).join('');
      }
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', 'open');
    }

    function openStateDialog(stateName) {
      openPolicyDialog(stateName, filteredList(policiesByState[stateName] || []));
    }

    function openFederalDialog() {
      openPolicyDialog('Federal / National', filteredList(federalPolicies));
    }

    function closeDialog() {
      if (!dialog) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }

    function updateFederalUi() {
      var count = filteredList(federalPolicies).length;
      if (federalLegend) federalLegend.hidden = count === 0;
      if (federalBtn) {
        federalBtn.hidden = count === 0;
        federalBtn.textContent = count === 1
          ? 'View 1 federal / national policy'
          : 'View ' + count + ' federal / national policies';
      }
    }

    function refreshChart() {
      if (!chart) return;
      chart.series[0].setData(buildMapData(), false);
      if (chart.series[1]) chart.series[1].setData(buildFederalPoints(), false);
      chart.redraw();
      updateFederalUi();
    }

    function mountChart(topology) {
      chart = Highcharts.mapChart(mapEl, {
        chart: { map: topology, backgroundColor: 'transparent' },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        mapNavigation: {
          enabled: false,
          enableButtons: false,
          enableMouseWheelZoom: false,
          enableDoubleClickZoom: false,
          enableTouchZoom: false
        },
        colorAxis: { min: 0, minColor: INACTIVE_COLOR, maxColor: ACTIVE_COLOR },
        tooltip: {
          useHTML: true,
          formatter: function () {
            var count = this.point.policyCount || 0;
            var label = this.point.name || '';
            return '<strong>' + escapeHtml(label) + '</strong><br/>Related policies: ' + count;
          }
        },
        series: [
          {
            name: 'Policies',
            data: buildMapData(),
            joinBy: 'hc-key',
            nullColor: INACTIVE_COLOR,
            borderColor: '#ffffff',
            borderWidth: 0.75,
            states: { hover: { color: '#D9790D' } },
            dataLabels: { enabled: false },
            point: {
              events: {
                click: function () {
                  if ((this.policyCount || 0) > 0) openStateDialog(this.name);
                }
              }
            }
          },
          {
            type: 'mappoint',
            name: 'Federal',
            data: buildFederalPoints(),
            enableMouseTracking: true,
            stickyTracking: false,
            dataLabels: {
              enabled: true,
              format: 'Federal',
              style: {
                color: FEDERAL_COLOR,
                fontSize: '11px',
                fontWeight: '700',
                textOutline: '2px contrast'
              }
            },
            point: {
              events: {
                click: function () {
                  openFederalDialog();
                }
              }
            }
          }
        ]
      });
    }

    if (filterEl) {
      filterEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-status]');
        if (!btn) return;
        activeStatus = btn.getAttribute('data-status') || 'all';
        renderFilters();
        renderList();
        refreshChart();
      });
    }
    if (dialogClose) dialogClose.addEventListener('click', closeDialog);
    if (dialog) {
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) closeDialog();
      });
    }
    if (federalBtn) {
      federalBtn.addEventListener('click', openFederalDialog);
    }

    var searchEl = root.querySelector('[data-ga-map-search]');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        renderList();
        refreshChart();
      });
    }
    function bindSlider(selector) {
      var track = root.querySelector(selector);
      if (!track) return;
      track.addEventListener('click', function (e) {
        var btn = e.target.closest('.ga-jur__opt');
        if (!btn || !track.contains(btn)) return;
        var opts = track.querySelectorAll('.ga-jur__opt');
        for (var i = 0; i < opts.length; i++) {
          var on = opts[i] === btn;
          opts[i].classList.toggle('is-on', on);
          opts[i].setAttribute('aria-checked', on ? 'true' : 'false');
        }
        var value = btn.getAttribute('data-ga-jur');
        if (value == null) value = btn.getAttribute('data-ga-kind') || '';
        track.setAttribute('data-jur', value);
        renderList();
        refreshChart();
      });
    }
    bindSlider('[data-ga-map-jur]');
    bindSlider('[data-ga-map-kind]');
    if (searchEl || root.querySelector('[data-ga-map-jur]') || root.querySelector('[data-ga-map-kind]')) {
      window.GA_POLICY_MAP_FILTERS = true;
    }

    groupPolicies();
    renderFilters();
    renderList();
    updateFederalUi();

    var mappedCount = Object.keys(policiesByState).length;
    var federalCount = federalPolicies.length;
    var statusParts = [];
    if (mappedCount) {
      statusParts.push(mappedCount + ' state' + (mappedCount === 1 ? '' : 's') + ' with related policies');
    }
    if (federalCount) {
      statusParts.push(federalCount + ' federal / national polic' + (federalCount === 1 ? 'y' : 'ies'));
    }
    setStatus(statusParts.length ? statusParts.join(' · ') : 'No related policies to map yet');

    if (!mapEl) return;
    function loadTopology(url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('map fetch ' + r.status);
        return r.json();
      });
    }
    loadTopology(MAP_URL)
      .catch(function () { return loadTopology(MAP_URL_FALLBACK); })
      .then(mountChart)
      .catch(function () {
        setStatus('Unable to load map geometry.');
      });
  }

  function isHidden(el) {
    if (!el) return true;
    if (el.hidden) return true;
    var node = el;
    while (node && node !== document.body) {
      if (node.hidden) return true;
      node = node.parentElement;
    }
    return false;
  }

  function boot() {
    var data = window.GA_POLICY_MAP_DATA || { policies: [] };
    var root = document.getElementById('gaPolicyMapRoot');
    if (!root) return;

    // Preview (and similar) may keep the detail section hidden on first paint.
    // Init immediately when visible; otherwise wait for the container to appear.
    if (!isHidden(root)) {
      init(data);
      return;
    }

    if (window.__gaPolicyMapVisibilityWatch) return;
    window.__gaPolicyMapVisibilityWatch = true;

    var observer = null;
    if (window.MutationObserver) {
      observer = new MutationObserver(function () {
        if (isHidden(root)) return;
        if (observer) observer.disconnect();
        window.__gaPolicyMapVisibilityWatch = false;
        init(window.GA_POLICY_MAP_DATA || data);
      });
      observer.observe(document.documentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: ['hidden', 'style', 'class']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.GA_POLICY_MAP = { init: init, boot: boot };
})();
