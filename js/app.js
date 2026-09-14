/* ===========================================================
   Carnet de comptes — logique applicative
   Tout est local : aucune requête réseau, aucun traqueur.
   =========================================================== */
(function () {
  "use strict";

  var APP_VERSION = "5.0";
  var STORAGE_KEY = "carnetComptes_v5";
  var LEGACY_V3 = "carnetComptes_v3";
  var LEGACY_V2 = "carnetComptes_v2";
  var INSTALL_HIDE = "carnetInstallHidden";

  var MONTHS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  var MSHORT = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  var DONUT = ["#A13D2C","#B08D57","#2F6F4E","#5B564C","#8C6D3F","#C58A5B","#7A8B5A","#6E4B3A","#9AA07E","#3F5A50"];

  var DEFAULT_CATEGORIES = [
    { id:"salaire", name:"Salaire", type:"entree" },
    { id:"autres_revenus", name:"Autres revenus", type:"entree" },
    { id:"loyer", name:"Loyer", type:"sortie" },
    { id:"edf", name:"Électricité / EDF", type:"sortie" },
    { id:"internet", name:"Internet / Box", type:"sortie" },
    { id:"telephone", name:"Téléphone", type:"sortie" },
    { id:"transport", name:"Transport (Navigo)", type:"sortie" },
    { id:"ass_auto", name:"Assurance auto", type:"sortie" },
    { id:"ass_habitation", name:"Assurance habitation", type:"sortie" },
    { id:"mutuelle", name:"Mutuelle santé", type:"sortie" },
    { id:"streaming", name:"Netflix / streaming", type:"sortie" },
    { id:"marche", name:"Marché / courses", type:"sortie" },
    { id:"loisirs", name:"Loisirs", type:"sortie" },
    { id:"vacances", name:"Vacances", type:"sortie" },
    { id:"coiffeur", name:"Coiffeur", type:"sortie" },
    { id:"divers", name:"Divers", type:"sortie" }
  ];

  var DEFAULT_SETTINGS = { theme:"auto", showDelta:true, showSearch:true, lastBackup:null };

  /* ---------------------------------------------------------
     Petites fonctions utilitaires
     --------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };
  var key = function (y, m) { return y + "-" + String(m + 1).padStart(2, "0"); };
  var uid = function () { return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var round2 = function (n) { return Math.round((Number(n) || 0) * 100) / 100; };

  function fmt(n) {
    n = Number(n) || 0;
    return n.toLocaleString("fr-FR", { minimumFractionDigits:2, maximumFractionDigits:2 }) + " €";
  }
  function fmtShort(n) {
    n = Math.round(Number(n) || 0);
    return n.toLocaleString("fr-FR") + " €";
  }
  function signed(n) {
    return (n >= 0 ? "+ " : "− ") + fmt(Math.abs(n));
  }
  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : s;
    return d.innerHTML;
  }
  function hexA(h, a) {
    h = (h || "").trim();
    if (h.charAt(0) !== "#" || h.length < 7) return h;
    return "rgba(" + parseInt(h.slice(1,3),16) + "," + parseInt(h.slice(3,5),16) + "," + parseInt(h.slice(5,7),16) + "," + a + ")";
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function palette() {
    return {
      credit: cssVar("--credit"), debit: cssVar("--debit"),
      ink: cssVar("--ink-soft"), page: cssVar("--page-2"),
      gold: cssVar("--gold-soft"), amber: cssVar("--amber")
    };
  }

  /** Évalue une expression additive simple : « 40+12,50-3 ». */
  function evalExpr(raw) {
    if (raw === undefined || raw === null) return null;
    var s = String(raw).replace(/\s+/g, "").replace(/,/g, ".");
    if (s === "") return null;
    if (!/^[-+]?(\d+\.?\d*)([-+]\d+\.?\d*)*$/.test(s)) return NaN;
    var m = s.match(/[+-]?\d+\.?\d*/g);
    if (!m) return NaN;
    var t = 0;
    m.forEach(function (x) { t += parseFloat(x); });
    return round2(t);
  }

  /* ---------------------------------------------------------
     État : chargement et migrations
     --------------------------------------------------------- */
  function freshState() {
    return {
      version: 5,
      soldeInitial: 0,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      categories: DEFAULT_CATEGORIES.map(function (c) { return Object.assign({}, c); }),
      entries: {}
    };
  }

  function fromV3(old) {
    var s = freshState();
    s.soldeInitial = Number(old.soldeInitial) || 0;
    if (Array.isArray(old.categories) && old.categories.length) s.categories = old.categories;
    Object.keys(old.entries || {}).forEach(function (k) {
      s.entries[k] = {};
      Object.keys(old.entries[k]).forEach(function (cid) {
        var c = old.entries[k][cid] || {};
        s.entries[k][cid] = { raw: String(c.raw == null ? "" : c.raw), val: Number(c.val) || 0, done: !!c.done, items: [] };
      });
    });
    return s;
  }

  function fromV2(old) {
    var s = freshState();
    s.soldeInitial = Number(old.soldeInitial) || 0;
    if (Array.isArray(old.categories) && old.categories.length) s.categories = old.categories;
    Object.keys(old.entries || {}).forEach(function (k) {
      s.entries[k] = {};
      Object.keys(old.entries[k]).forEach(function (cid) {
        var v = Number(old.entries[k][cid]) || 0;
        s.entries[k][cid] = { raw: String(v), val: v, done: false, items: [] };
      });
    });
    return s;
  }

  /** Remet un état importé d'aplomb (champs manquants, types douteux). */
  function normalize(s) {
    var out = freshState();
    if (!s || typeof s !== "object") return out;
    out.soldeInitial = Number(s.soldeInitial) || 0;
    out.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings || {});
    if (Array.isArray(s.categories) && s.categories.length) {
      out.categories = s.categories.filter(function (c) { return c && c.id && c.name; }).map(function (c) {
        return { id: String(c.id), name: String(c.name), type: c.type === "entree" ? "entree" : "sortie",
                 budget: c.budget == null || c.budget === "" ? null : Number(c.budget) || null };
      });
    }
    out.entries = {};
    Object.keys(s.entries || {}).forEach(function (k) {
      if (!/^\d{4}-\d{2}$/.test(k)) return;
      out.entries[k] = {};
      Object.keys(s.entries[k] || {}).forEach(function (cid) {
        var c = s.entries[k][cid] || {};
        var items = Array.isArray(c.items) ? c.items.filter(function (it) { return it && !isNaN(Number(it.amount)); })
          .map(function (it) { return { id: it.id || uid(), label: String(it.label || ""), amount: round2(it.amount) }; }) : [];
        out.entries[k][cid] = { raw: String(c.raw == null ? "" : c.raw), val: Number(c.val) || 0, done: !!c.done, items: items };
        if (items.length) out.entries[k][cid].val = round2(items.reduce(function (a, i) { return a + i.amount; }, 0));
      });
    });
    return out;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
      var v3 = localStorage.getItem(LEGACY_V3);
      if (v3) return normalize(fromV3(JSON.parse(v3)));
      var v2 = localStorage.getItem(LEGACY_V2);
      if (v2) return normalize(fromV2(JSON.parse(v2)));
    } catch (e) { /* stockage illisible : on repart proprement */ }
    return freshState();
  }

  var saveFailed = false;
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveFailed = false;
    } catch (e) {
      if (!saveFailed) {
        saveFailed = true;
        toast("Enregistrement impossible : stockage plein ou navigation privée.", "Sauvegarder", backupJSON, true);
      }
    }
  }

  var state = loadState();

  /* ---------------------------------------------------------
     Annulation (pile d'états)
     --------------------------------------------------------- */
  var undoStack = [];
  function pushUndo() {
    try { undoStack.push(JSON.stringify(state)); } catch (e) { return; }
    if (undoStack.length > 25) undoStack.shift();
    $("undoBtn").hidden = false;
  }
  function undo() {
    if (!undoStack.length) return;
    var prev = undoStack.pop();
    try { state = normalize(JSON.parse(prev)); } catch (e) { return; }
    save();
    if (!undoStack.length) $("undoBtn").hidden = true;
    render();
    toast("Action annulée.");
  }

  /* ---------------------------------------------------------
     Thème
     --------------------------------------------------------- */
  var mqDark = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    var t = state.settings.theme || "auto";
    var dark = t === "sombre" || (t === "auto" && mqDark.matches);
    document.documentElement.setAttribute("data-theme", dark ? "sombre" : "clair");
    Array.prototype.forEach.call(document.querySelectorAll("#themeSeg button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-theme") === t);
    });
    if (typeof redrawCharts === "function") redrawCharts();
  }
  if (mqDark.addEventListener) mqDark.addEventListener("change", function () { if ((state.settings.theme || "auto") === "auto") applyTheme(); });

  /* ---------------------------------------------------------
     Calculs
     --------------------------------------------------------- */
  var today = new Date();
  var cursor = { year: today.getFullYear(), month: today.getMonth() };
  var currentView = "home";
  var chartYear = cursor.year;
  var selectedMonths = null;
  var selectedCat = null;
  var charts = {};
  var searchTerm = "";

  function getEntries(y, m) {
    var k = key(y, m);
    if (!state.entries[k]) state.entries[k] = {};
    return state.entries[k];
  }
  function cellVal(cell) {
    if (!cell) return 0;
    if (cell.items && cell.items.length) return round2(cell.items.reduce(function (a, i) { return a + (Number(i.amount) || 0); }, 0));
    return Number(cell.val) || 0;
  }
  function hasAmount(cell) {
    return !!cell && ((cell.items && cell.items.length > 0) || String(cell.raw) !== "");
  }
  function catsOf(type) {
    return state.categories.filter(function (c) { return c.type === type; });
  }
  function monthTotal(y, m, type) {
    var e = getEntries(y, m), s = 0;
    catsOf(type).forEach(function (c) { s += cellVal(e[c.id]); });
    return round2(s);
  }
  function monthTotalDone(y, m, type) {
    var e = getEntries(y, m), s = 0;
    catsOf(type).forEach(function (c) { var cell = e[c.id]; if (cell && cell.done) s += cellVal(cell); });
    return round2(s);
  }
  function cumulativeSolde(y, m) {
    var t = y * 12 + m, tot = Number(state.soldeInitial) || 0;
    Object.keys(state.entries).forEach(function (k) {
      var p = k.split("-"), ky = +p[0], km = +p[1] - 1;
      if (ky * 12 + km <= t) tot += monthTotal(ky, km, "entree") - monthTotal(ky, km, "sortie");
    });
    return round2(tot);
  }
  function prevOf(y, m) {
    return m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 };
  }
  function monthHasData(y, m) {
    var e = state.entries[key(y, m)];
    return !!e && Object.keys(e).some(function (id) { return hasAmount(e[id]); });
  }
  function knownYears() {
    var ys = {};
    ys[today.getFullYear()] = 1; ys[cursor.year] = 1; ys[chartYear] = 1;
    Object.keys(state.entries).forEach(function (k) { ys[+k.split("-")[0]] = 1; });
    return Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });
  }
  function budgetSummary(y, m) {
    var e = getEntries(y, m), planned = 0, spent = 0, n = 0;
    catsOf("sortie").forEach(function (c) {
      if (c.budget > 0) { planned += c.budget; spent += cellVal(e[c.id]); n++; }
    });
    return { planned: round2(planned), spent: round2(spent), count: n };
  }

  /* ---------------------------------------------------------
     Graphiques
     --------------------------------------------------------- */
  function drawChart(id, cfg) {
    var el = $(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el, cfg);
  }
  function redrawCharts() {
    if (currentView === "home") renderHome();
    else if (currentView === "cat") renderCat();
    else if (currentView === "charts") renderCharts();
  }

  /* ---------------------------------------------------------
     Notification
     --------------------------------------------------------- */
  var toastTimer = null;
  function toast(msg, actionLabel, onAction, persist) {
    var t = $("toast"), b = $("toastAction");
    $("toastText").textContent = msg;
    if (actionLabel) {
      b.textContent = actionLabel; b.hidden = false;
      b.onclick = function () { t.classList.remove("show"); if (onAction) onAction(); };
    } else { b.hidden = true; b.onclick = null; }
    t.classList.add("show");
    clearTimeout(toastTimer);
    if (!persist) toastTimer = setTimeout(function () { t.classList.remove("show"); }, 4200);
  }
  // Toute interaction ailleurs referme la notification : elle ne doit jamais
  // rester en travers d'un bouton.
  document.addEventListener("pointerdown", function (e) {
    var t = $("toast");
    if (!t.classList.contains("show")) return;
    if (e.target.closest("#toast")) return;
    t.classList.remove("show");
  }, true);

  /* ---------------------------------------------------------
     Feuilles modales
     --------------------------------------------------------- */
  function open(id) { $(id).classList.add("open"); }
  function close(id) { $(id).classList.remove("open"); }

  var OVERLAY_CLOSERS = {
    overlayMenu:"closeMenu", overlayNewCat:"cancelNewCat", overlayManageCat:"closeManageCat",
    overlayBudgets:"cancelBudgets", overlayDetail:"closeDetail", overlaySolde:"cancelSolde",
    overlayReset:"cancelReset", overlayCatPick:"closeCatPick", overlayYearPick:"closeYearPick",
    overlayMonthPick:"closeMonthPick", overlayDup:"cancelDup", overlayInstall:"closeInstall",
    overlaySync:"closeSync", overlayAbout:"closeAbout"
  };
  Object.keys(OVERLAY_CLOSERS).forEach(function (id) {
    var ov = $(id);
    if (!ov) return;
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) dismissOverlay(ov); });
  });
  function topOverlay() {
    var l = document.querySelectorAll(".overlay.open");
    return l.length ? l[l.length - 1] : null;
  }
  function dismissOverlay(ov) {
    var b = $(OVERLAY_CLOSERS[ov.id]);
    if (b) b.click(); else ov.classList.remove("open");
  }

  /* ---------------------------------------------------------
     Navigation
     --------------------------------------------------------- */
  var TITLES = { home:"Accueil", month:"Saisie du mois", cat:"Filtre par catégorie", charts:"Graphiques & bilan" };

  function go(view) {
    currentView = view;
    Array.prototype.forEach.call(document.querySelectorAll(".tabbar button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-go") === view);
    });
    $("screenTitle").textContent = TITLES[view];
    $("viewHome").classList.toggle("active", view === "home");
    $("viewMonth").classList.toggle("active", view === "month");
    $("viewCat").classList.toggle("active", view === "cat");
    $("viewCharts").classList.toggle("active", view === "charts");
    $("periodNav").hidden = view !== "month";
    render();
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  function render() {
    if (currentView === "home") renderHome();
    else if (currentView === "month") renderMonth();
    else if (currentView === "cat") renderCat();
    else if (currentView === "charts") renderCharts();
  }
  Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function (b) {
    b.addEventListener("click", function () { go(b.getAttribute("data-go")); });
  });

  /* ---------------------------------------------------------
     Écran : accueil
     --------------------------------------------------------- */
  function renderHome() {
    var P = palette();
    var y = cursor.year, m = cursor.month;
    $("homeMonthLbl").textContent = MONTHS[m] + " " + y;

    var solde = cumulativeSolde(y, m);
    $("homeSolde").textContent = fmt(solde);

    var p = prevOf(y, m), prevSolde = cumulativeSolde(p.year, p.month), d = round2(solde - prevSolde);
    var de = $("homeSoldeDelta");
    if (monthHasData(y, m) || monthHasData(p.year, p.month)) {
      de.innerHTML = '<i class="ti ti-' + (d >= 0 ? "trending-up" : "trending-down") + '"></i>' +
        signed(d) + " vs " + MONTHS[p.month];
      de.className = "hero-delta " + (d >= 0 ? "pos" : "neg");
    } else { de.textContent = ""; de.className = "hero-delta"; }

    var te = monthTotal(y, m, "entree"), ts = monthTotal(y, m, "sortie");
    $("homeEntrees").textContent = fmt(te);
    $("homeSorties").textContent = fmt(ts);
    var diff = round2(te - ts), el = $("homeDiff");
    el.textContent = signed(diff);
    el.className = "v " + (diff >= 0 ? "pos" : "neg");

    // budget
    var bs = budgetSummary(y, m), card = $("homeBudgetCard");
    if (bs.count > 0 && bs.planned > 0) {
      card.hidden = false;
      var pct = Math.round(bs.spent / bs.planned * 100);
      var bar = $("homeBudgetBar");
      bar.style.width = Math.min(100, pct) + "%";
      bar.className = "gauge-fill" + (pct > 100 ? " over" : pct > 85 ? " warn" : "");
      $("homeBudgetPct").textContent = pct + " %";
      var reste = round2(bs.planned - bs.spent);
      $("homeBudgetTxt").textContent = reste >= 0
        ? fmt(bs.spent) + " sur " + fmt(bs.planned) + " — il reste " + fmt(reste) + " sur " + bs.count + " ligne(s) suivie(s)."
        : "Dépassement de " + fmt(-reste) + " sur les " + bs.count + " ligne(s) suivie(s).";
    } else card.hidden = true;

    // principales dépenses
    var e = getEntries(y, m);
    var tops = catsOf("sortie").map(function (c) { return { name: c.name, v: cellVal(e[c.id]) }; })
      .filter(function (x) { return x.v > 0; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 4);
    var topCard = $("homeTopCard");
    if (tops.length) {
      topCard.hidden = false;
      var max = tops[0].v;
      $("homeTop").innerHTML = tops.map(function (t) {
        return '<div class="top-row"><span class="nm">' + esc(t.name) + '</span>' +
          '<span class="bar"><i style="width:' + Math.round(t.v / max * 100) + '%"></i></span>' +
          '<span class="vl">' + fmt(t.v) + "</span></div>";
      }).join("");
    } else topCard.hidden = true;

    // reste à payer
    var sDone = monthTotalDone(y, m, "sortie"), reste2 = round2(ts - sDone);
    $("homeReste").textContent = fmt(reste2);
    $("homeResteTxt").textContent = ts > 0
      ? fmt(sDone) + " déjà payé sur " + fmt(ts) + " de sorties prévues."
      : "Aucune sortie saisie sur ce mois.";

    // courbe du solde sur l'année
    var labels = [], data = [];
    for (var i = 0; i < 12; i++) { labels.push(MSHORT[i]); data.push(cumulativeSolde(y, i)); }
    drawChart("sparkHome", {
      type:"line",
      data:{ labels:labels, datasets:[{ data:data, borderColor:P.gold, backgroundColor:hexA(P.gold, .14),
        borderWidth:2, pointRadius:0, tension:.35, fill:true }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:function (c) { return fmt(c.parsed.y); } } } },
        scales:{ x:{ display:false }, y:{ display:false } } }
    });
  }

  /* ---------------------------------------------------------
     Écran : saisie
     --------------------------------------------------------- */
  function renderPeriodLabels() {
    $("pmMonth").textContent = MONTHS[cursor.month].charAt(0).toUpperCase() + MONTHS[cursor.month].slice(1);
    $("pmYear").textContent = cursor.year;
  }

  /** Métadonnées affichées sous le nom : nb de lignes de détail, écart, budget. */
  function rowMetaHTML(cat, cell, prevEnt, p) {
    var meta = [];
    var items = (cell && cell.items) || [];
    var v = cellVal(cell);
    if (items.length) meta.push("<span>" + items.length + " ligne" + (items.length > 1 ? "s" : "") + "</span>");
    if (state.settings.showDelta !== false) {
      var pv = cellVal(prevEnt[cat.id]);
      if (hasAmount(cell) && pv > 0) {
        var d = round2(v - pv);
        if (Math.abs(d) >= 0.01) {
          var worse = cat.type === "sortie" ? d > 0 : d < 0;
          meta.push('<span class="delta ' + (worse ? "neg" : "pos") + '">' +
            (d > 0 ? "▲ +" : "▼ ") + fmt(Math.abs(d)) + " vs " + MSHORT[p.month].toLowerCase() + "</span>");
        }
      }
    }
    if (cat.budget > 0) {
      var over = v > cat.budget;
      meta.push('<span class="bud' + (over ? " over" : "") + '">budget ' + fmtShort(cat.budget) + (over ? " dépassé" : "") + "</span>");
    }
    return meta.join("");
  }

  /**
   * Met à jour UNE ligne sur place, sans reconstruire la liste.
   * Indispensable : reconstruire le DOM pendant que l'utilisateur touche
   * l'écran ferait disparaître l'élément visé et avalerait son geste.
   */
  function refreshRow(catId) {
    var row = document.querySelector('[data-row="' + catId + '"]');
    if (!row) return;
    var cat = state.categories.find(function (c) { return c.id === catId; });
    if (!cat) return;
    var cell = getEntries(cursor.year, cursor.month)[catId];
    var p = prevOf(cursor.year, cursor.month);
    var prevEnt = state.entries[key(p.year, p.month)] || {};
    var items = (cell && cell.items) || [];
    var locked = items.length > 0;
    var done = !!(cell && cell.done);

    row.classList.toggle("checked", done);
    var box = row.querySelector(".check-box");
    box.classList.toggle("on", done);

    var input = row.querySelector("input.amount");
    if (document.activeElement !== input) {
      input.value = hasAmount(cell) ? cellVal(cell).toFixed(2).replace(".", ",") : "";
    }
    input.readOnly = locked;

    var dbtn = row.querySelector(".detail-btn");
    dbtn.classList.toggle("has", locked);

    var name = row.querySelector(".name");
    var calc = name.querySelector(".calc-ic");
    var hasCalc = !!cell && !locked && /[+\-]/.test(String(cell.raw).replace(/^[-+]/, ""));
    if (hasCalc && !calc) {
      var i = document.createElement("i");
      i.className = "ti ti-calculator calc-ic";
      name.appendChild(i);
    } else if (!hasCalc && calc) calc.remove();

    var metaHTML = rowMetaHTML(cat, cell, prevEnt, p);
    var metaEl = row.querySelector(".meta");
    if (metaHTML) {
      if (!metaEl) {
        metaEl = document.createElement("span");
        metaEl.className = "meta";
        row.querySelector(".name-wrap").appendChild(metaEl);
      }
      metaEl.innerHTML = metaHTML;
    } else if (metaEl) metaEl.remove();
  }

  /** Après édition d'un montant : ligne concernée + totaux, rien de plus. */
  function refreshAfterEdit(catId) {
    refreshRow(catId);
    renderMonthTotals();
    renderBudgetCard();
  }

  function renderList(containerId, type) {
    var c = $(containerId);
    c.innerHTML = "";
    var cats = catsOf(type);
    if (searchTerm) {
      cats = cats.filter(function (x) { return x.name.toLowerCase().indexOf(searchTerm) >= 0; });
    }
    if (!cats.length) {
      c.innerHTML = '<div class="empty">' + (searchTerm ? "Aucune ligne ne correspond." : "Aucune ligne.") + "</div>";
      return;
    }
    var ent = getEntries(cursor.year, cursor.month);
    var p = prevOf(cursor.year, cursor.month);
    var prevEnt = state.entries[key(p.year, p.month)] || {};
    cats.forEach(function (cat) {
      var cell = ent[cat.id];
      var items = (cell && cell.items) || [];
      var locked = items.length > 0;
      var done = !!(cell && cell.done);
      var hasCalc = !!cell && !locked && /[+\-]/.test(String(cell.raw).replace(/^[-+]/, ""));
      var v = cellVal(cell);
      var display = hasAmount(cell) ? v.toFixed(2).replace(".", ",") : "";

      var metaHTML = rowMetaHTML(cat, cell, prevEnt, p);

      var row = document.createElement("div");
      row.className = "row" + (done ? " checked" : "");
      row.setAttribute("data-row", cat.id);
      row.innerHTML =
        '<button class="check-box' + (done ? " on" : "") + '" data-check="' + cat.id + '" aria-label="Marquer comme ' +
          (type === "entree" ? "reçu" : "payé") + '"><i class="ti ti-check ic"></i></button>' +
        '<span class="name-wrap"><span class="name"><span class="txt">' + esc(cat.name) + "</span>" +
          (hasCalc ? '<i class="ti ti-calculator calc-ic"></i>' : "") + "</span>" +
          (metaHTML ? '<span class="meta">' + metaHTML + "</span>" : "") + "</span>" +
        '<button class="detail-btn' + (locked ? " has" : "") + '" data-detail="' + cat.id +
          '" aria-label="Détail de la ligne"><i class="ti ti-receipt"></i></button>' +
        '<input class="amount" inputmode="text" data-cat="' + cat.id + '" placeholder="0,00" value="' +
          display + '"' + (locked ? " readonly" : "") + ">";
      c.appendChild(row);
    });
  }

  function renderMonthTotals() {
    var y = cursor.year, m = cursor.month;
    var te = monthTotal(y, m, "entree"), ts = monthTotal(y, m, "sortie");
    $("totalEntrees").textContent = fmt(te);
    $("totalSorties").textContent = fmt(ts);
    var diff = round2(te - ts), el = $("diffMois");
    el.textContent = signed(diff);
    el.className = "value " + (diff >= 0 ? "pos" : "neg");
    $("soldeCumule").textContent = fmt(cumulativeSolde(y, m));
    var eDone = monthTotalDone(y, m, "entree"), sDone = monthTotalDone(y, m, "sortie");
    $("rEntrees").textContent = fmt(eDone);
    $("rSorties").textContent = fmt(sDone);
    $("rReste").textContent = fmt(round2(ts - sDone));
  }

  function renderBudgetCard() {
    var card = $("budgetCard"), list = $("budgetList");
    var e = getEntries(cursor.year, cursor.month);
    var rows = catsOf("sortie").filter(function (c) { return c.budget > 0; });
    if (!rows.length) { card.hidden = true; return; }
    card.hidden = false;
    list.innerHTML = rows.map(function (c) {
      var v = cellVal(e[c.id]), pct = Math.round(v / c.budget * 100);
      var cls = pct > 100 ? "over" : pct > 85 ? "warn" : "";
      return '<div class="bud-row"><div class="bud-head"><span class="nm">' + esc(c.name) + "</span>" +
        '<span class="vl' + (pct > 100 ? " over" : "") + '">' + fmt(v) + " / " + fmt(c.budget) + "</span></div>" +
        '<div class="gauge"><div class="gauge-fill ' + cls + '" style="width:' + Math.min(100, pct) + '%"></div></div></div>';
    }).join("");
  }

  function renderMonth() {
    renderPeriodLabels();
    $("searchWrap").hidden = state.settings.showSearch === false;
    renderList("listEntrees", "entree");
    renderList("listSorties", "sortie");
    renderMonthTotals();
    renderBudgetCard();
  }

  var viewMonth = $("viewMonth");

  viewMonth.addEventListener("focusin", function (e) {
    if (!e.target.classList.contains("amount") || e.target.readOnly) return;
    var id = e.target.getAttribute("data-cat");
    var cell = getEntries(cursor.year, cursor.month)[id];
    if (cell && String(cell.raw) !== "") e.target.value = String(cell.raw).replace(/\./g, ",");
    setTimeout(function () { try { e.target.select(); } catch (err) {} }, 0);
  });

  viewMonth.addEventListener("focusout", function (e) {
    if (!e.target.classList.contains("amount") || e.target.readOnly) return;
    var id = e.target.getAttribute("data-cat");
    var ent = getEntries(cursor.year, cursor.month);
    var raw = e.target.value.trim();
    var before = ent[id] ? JSON.stringify(ent[id]) : "";

    if (raw === "") {
      if (!ent[id]) return;
      pushUndo(); delete ent[id]; save(); refreshAfterEdit(id); return;
    }
    var res = evalExpr(raw);
    if (isNaN(res)) {
      var old = ent[id];
      if (old) { e.target.value = cellVal(old).toFixed(2).replace(".", ","); }
      else { e.target.value = ""; }
      toast("Montant non reconnu. Exemples valides : 42 ou 40+12,50.");
      return;
    }
    if (res === null) { if (ent[id]) { pushUndo(); delete ent[id]; save(); refreshAfterEdit(id); } return; }
    var prev = ent[id] || {};
    var next = { raw: raw.replace(/,/g, "."), val: res, done: prev.done || false, items: prev.items || [] };
    if (JSON.stringify(next) === before) { refreshAfterEdit(id); return; }
    pushUndo();
    ent[id] = next;
    save();
    refreshAfterEdit(id);
  });

  viewMonth.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.classList.contains("amount")) e.target.blur();
  });

  viewMonth.addEventListener("click", function (e) {
    var det = e.target.closest("[data-detail]");
    if (det) { openDetail(det.getAttribute("data-detail")); return; }

    var amt = e.target.closest("input.amount");
    if (amt && amt.readOnly) { openDetail(amt.getAttribute("data-cat")); return; }

    var cb = e.target.closest("[data-check]");
    if (!cb) return;
    var id = cb.getAttribute("data-check");
    var ent = getEntries(cursor.year, cursor.month), cell = ent[id];
    if (!hasAmount(cell)) { toast("Saisis d'abord un montant sur cette ligne."); return; }
    pushUndo();
    cell.done = !cell.done;
    save();
    refreshAfterEdit(id);
  });

  $("prevMonth").addEventListener("click", function () {
    cursor.month--; if (cursor.month < 0) { cursor.month = 11; cursor.year--; }
    renderMonth();
  });
  $("nextMonth").addEventListener("click", function () {
    cursor.month++; if (cursor.month > 11) { cursor.month = 0; cursor.year++; }
    renderMonth();
  });
  $("todayBtn").addEventListener("click", function () {
    var n = new Date();
    cursor.year = n.getFullYear(); cursor.month = n.getMonth();
    renderMonth();
    toast("Retour à " + MONTHS[cursor.month] + " " + cursor.year + ".");
  });

  // recherche
  $("searchInput").addEventListener("input", function (e) {
    searchTerm = e.target.value.trim().toLowerCase();
    renderList("listEntrees", "entree");
    renderList("listSorties", "sortie");
  });
  $("searchClear").addEventListener("click", function () {
    $("searchInput").value = ""; searchTerm = "";
    renderList("listEntrees", "entree"); renderList("listSorties", "sortie");
  });

  /* ---------------------------------------------------------
     Détail d'une ligne
     --------------------------------------------------------- */
  var detailCatId = null;

  function openDetail(catId) {
    detailCatId = catId;
    var cat = state.categories.find(function (c) { return c.id === catId; });
    if (!cat) return;
    $("detailTitle").textContent = cat.name;
    $("detailDesc").textContent = "Détail de " + MONTHS[cursor.month] + " " + cursor.year +
      ". Ajoute chaque dépense : le total remplacera la saisie rapide.";
    $("detailLabel").value = "";
    $("detailAmount").value = "";
    renderDetail();
    open("overlayDetail");
    setTimeout(function () { $("detailLabel").focus(); }, 60);
  }

  function renderDetail() {
    var ent = getEntries(cursor.year, cursor.month);
    var cell = ent[detailCatId];
    var items = (cell && cell.items) || [];
    var list = $("detailList");
    if (!items.length) {
      var manual = cell && String(cell.raw) !== "" ? cellVal(cell) : 0;
      list.innerHTML = '<div class="empty">' + (manual > 0
        ? "Aucun détail. Montant saisi directement : " + fmt(manual) + "."
        : "Aucune ligne pour l'instant.") + "</div>";
    } else {
      list.innerHTML = items.map(function (it) {
        return '<div class="detail-item"><span class="nm">' + (esc(it.label) || '<span class="muted">Sans libellé</span>') +
          '</span><span class="am">' + fmt(it.amount) + "</span>" +
          '<button data-del-item="' + it.id + '" aria-label="Supprimer"><i class="ti ti-trash"></i></button></div>';
      }).join("");
    }
    $("detailTotal").textContent = fmt(items.reduce(function (a, i) { return a + i.amount; }, 0));
  }

  function addDetailItem() {
    var label = $("detailLabel").value.trim();
    var amount = evalExpr($("detailAmount").value);
    if (amount === null || isNaN(amount)) { toast("Indique un montant valide."); $("detailAmount").focus(); return; }
    var ent = getEntries(cursor.year, cursor.month);
    pushUndo();
    if (!ent[detailCatId]) ent[detailCatId] = { raw:"", val:0, done:false, items:[] };
    var cell = ent[detailCatId];
    if (!cell.items) cell.items = [];
    // Première ligne de détail : on convertit le montant déjà saisi en première entrée.
    if (!cell.items.length && String(cell.raw) !== "" && cellVal(cell) > 0) {
      cell.items.push({ id: uid(), label: "Saisie initiale", amount: cellVal(cell) });
    }
    cell.items.push({ id: uid(), label: label, amount: amount });
    cell.raw = "";
    cell.val = round2(cell.items.reduce(function (a, i) { return a + i.amount; }, 0));
    save();
    $("detailLabel").value = ""; $("detailAmount").value = "";
    renderDetail();
    $("detailLabel").focus();
  }
  $("detailAdd").addEventListener("click", addDetailItem);
  $("detailAmount").addEventListener("keydown", function (e) { if (e.key === "Enter") addDetailItem(); });
  $("detailLabel").addEventListener("keydown", function (e) { if (e.key === "Enter") $("detailAmount").focus(); });

  $("detailList").addEventListener("click", function (e) {
    var b = e.target.closest("[data-del-item]");
    if (!b) return;
    var itemId = b.getAttribute("data-del-item");
    var cell = getEntries(cursor.year, cursor.month)[detailCatId];
    if (!cell) return;
    pushUndo();
    cell.items = cell.items.filter(function (i) { return i.id !== itemId; });
    cell.val = round2(cell.items.reduce(function (a, i) { return a + i.amount; }, 0));
    if (!cell.items.length) { cell.raw = cell.val > 0 ? String(cell.val) : ""; }
    save();
    renderDetail();
  });

  $("detailClear").addEventListener("click", function () {
    var ent = getEntries(cursor.year, cursor.month), cell = ent[detailCatId];
    if (!cell || !cell.items || !cell.items.length) { close("overlayDetail"); renderMonth(); return; }
    pushUndo();
    cell.items = []; cell.raw = ""; cell.val = 0;
    delete ent[detailCatId];
    save();
    renderDetail(); renderMonth();
    toast("Détail effacé.");
  });
  $("closeDetail").addEventListener("click", function () {
    close("overlayDetail");
    if (currentView === "month") refreshAfterEdit(detailCatId);
  });

  /* ---------------------------------------------------------
     Écran : catégorie
     --------------------------------------------------------- */
  function renderCat() {
    var P = palette();
    if (!selectedCat && state.categories.length) selectedCat = state.categories[0].id;
    var cat = state.categories.find(function (c) { return c.id === selectedCat; });
    $("catSelectLabel").textContent = cat ? cat.name : "Choisir une catégorie";
    $("catYearLbl").textContent = chartYear;
    if (!cat) {
      $("catDetail").innerHTML = '<div class="empty">Aucune catégorie.</div>';
      $("catStats").innerHTML = ""; $("catTrend").textContent = "";
      return;
    }
    var labels = [], data = [], sum = 0, cnt = 0, maxM = -1, maxV = 0;
    for (var m = 0; m < 12; m++) {
      var v = cellVal(getEntries(chartYear, m)[cat.id]);
      labels.push(MSHORT[m]); data.push(v);
      if (v > 0) { sum += v; cnt++; if (v > maxV) { maxV = v; maxM = m; } }
    }
    sum = round2(sum);
    var color = cat.type === "entree" ? P.credit : P.debit;

    // tendance : moyenne des 3 derniers mois saisis contre les 3 précédents
    var filled = [];
    for (var i = 0; i < 12; i++) if (data[i] > 0) filled.push({ m:i, v:data[i] });
    var trendEl = $("catTrend");
    if (filled.length >= 4) {
      var half = Math.min(3, Math.floor(filled.length / 2));
      var recent = filled.slice(-half).reduce(function (a, x) { return a + x.v; }, 0) / half;
      var older = filled.slice(-2 * half, -half).reduce(function (a, x) { return a + x.v; }, 0) / half;
      var pct = older > 0 ? Math.round((recent - older) / older * 100) : 0;
      var up = pct >= 0;
      var bad = cat.type === "sortie" ? up : !up;
      trendEl.className = "trend " + (bad ? "neg" : "pos");
      trendEl.innerHTML = '<i class="ti ti-' + (up ? "trending-up" : "trending-down") + '"></i>' +
        (up ? "+" : "") + pct + " % récemment";
    } else { trendEl.textContent = ""; trendEl.className = "clab"; }

    drawChart("catLine", {
      type:"line",
      data:{ labels:labels, datasets:[{ data:data, borderColor:color, backgroundColor:hexA(color, .14),
        borderWidth:2, pointRadius:2.5, tension:.3, fill:true }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:function (c) { return fmt(c.parsed.y); } } } },
        scales:{ x:{ ticks:{ font:{ size:9 }, color:P.ink }, grid:{ display:false } },
                 y:{ display:false, beginAtZero:true } } }
    });

    $("catStats").innerHTML =
      '<div class="bilan">' +
        '<div class="b"><p class="k">Total ' + chartYear + '</p><p class="v">' + fmt(sum) + "</p></div>" +
        '<div class="b"><p class="k">Moyenne / mois saisi</p><p class="v">' + fmt(cnt ? sum / cnt : 0) + "</p></div>" +
        '<div class="b"><p class="k">Mois le plus élevé</p><p class="v">' + (maxM >= 0 ? MSHORT[maxM] + " · " + fmtShort(maxV) : "—") + "</p></div>" +
        '<div class="b"><p class="k">Mois saisis</p><p class="v">' + cnt + " / 12</p></div>" +
      "</div>";

    var html = "";
    for (var m2 = 0; m2 < 12; m2++) {
      var v2 = cellVal(getEntries(chartYear, m2)[cat.id]);
      if (v2 > 0) {
        var cell = getEntries(chartYear, m2)[cat.id];
        var n = cell && cell.items ? cell.items.length : 0;
        html += '<div class="detail-row"><span>' + MONTHS[m2] +
          (n ? ' <span class="muted">· ' + n + " ligne" + (n > 1 ? "s" : "") + "</span>" : "") +
          '</span><span class="val">' + fmt(v2) + "</span></div>";
      }
    }
    if (!html) html = '<div class="empty">Aucun montant sur ' + chartYear + ".</div>";
    $("catDetail").innerHTML = html;
  }

  /* ---------------------------------------------------------
     Écran : graphiques & bilan
     --------------------------------------------------------- */
  function activeMonths() {
    return selectedMonths === null ? [0,1,2,3,4,5,6,7,8,9,10,11] : selectedMonths.slice();
  }
  function renderMPSummary() {
    var s = selectedMonths, lbl;
    if (s === null || s.length === 12) lbl = "Tous";
    else if (s.length === 0) lbl = "Aucun";
    else lbl = s.map(function (m) { return MSHORT[m]; }).join(", ");
    $("mpSel").textContent = lbl;
  }
  function renderMonthGrid() {
    var g = $("monthGrid");
    g.innerHTML = "";
    var act = activeMonths();
    MSHORT.forEach(function (ms, i) {
      var b = document.createElement("button");
      b.textContent = ms;
      if (act.indexOf(i) >= 0) b.classList.add("on");
      b.addEventListener("click", function () {
        if (selectedMonths === null) selectedMonths = [0,1,2,3,4,5,6,7,8,9,10,11];
        var idx = selectedMonths.indexOf(i);
        if (idx >= 0) selectedMonths.splice(idx, 1); else selectedMonths.push(i);
        selectedMonths.sort(function (a, b2) { return a - b2; });
        renderMonthGrid(); renderMPSummary(); renderChartsData();
      });
      g.appendChild(b);
    });
  }
  function renderCharts() {
    $("yearSelectLabel").textContent = "Année " + chartYear;
    renderMPSummary(); renderMonthGrid(); renderChartsData();
  }

  function renderChartsData() {
    var P = palette();
    var act = activeMonths(), labels = [], ent = [], sor = [], solde = [];
    act.forEach(function (m) {
      labels.push(MSHORT[m]);
      ent.push(monthTotal(chartYear, m, "entree"));
      sor.push(monthTotal(chartYear, m, "sortie"));
      solde.push(cumulativeSolde(chartYear, m));
    });

    var totE = round2(ent.reduce(function (a, b) { return a + b; }, 0));
    var totS = round2(sor.reduce(function (a, b) { return a + b; }, 0));
    var nMonths = act.filter(function (m) { return monthHasData(chartYear, m); }).length;
    var best = null, worst = null;
    act.forEach(function (m) {
      if (!monthHasData(chartYear, m)) return;
      var d = round2(monthTotal(chartYear, m, "entree") - monthTotal(chartYear, m, "sortie"));
      if (!best || d > best.d) best = { m:m, d:d };
      if (!worst || d < worst.d) worst = { m:m, d:d };
    });
    var net = round2(totE - totS);
    $("bilan").innerHTML =
      '<div class="b"><p class="k">Total entrées</p><p class="v pos">' + fmt(totE) + "</p></div>" +
      '<div class="b"><p class="k">Total sorties</p><p class="v neg">' + fmt(totS) + "</p></div>" +
      '<div class="b"><p class="k">Épargne nette</p><p class="v ' + (net >= 0 ? "pos" : "neg") + '">' + signed(net) + "</p></div>" +
      '<div class="b"><p class="k">Sorties / mois saisi</p><p class="v">' + fmt(nMonths ? totS / nMonths : 0) + "</p></div>" +
      (best ? '<div class="b"><p class="k">Meilleur mois</p><p class="v pos">' + MSHORT[best.m] + " · " + fmtShort(best.d) + "</p></div>" : "") +
      (worst && (!best || worst.m !== best.m) ? '<div class="b"><p class="k">Mois le plus tendu</p><p class="v neg">' + MSHORT[worst.m] + " · " + fmtShort(worst.d) + "</p></div>" : "");

    drawChart("barChart", {
      type:"bar",
      data:{ labels:labels, datasets:[
        { label:"Entrées", data:ent, backgroundColor:P.credit, borderRadius:3 },
        { label:"Sorties", data:sor, backgroundColor:P.debit, borderRadius:3 }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:function (c) { return c.dataset.label + " : " + fmt(c.parsed.y); } } } },
        scales:{ x:{ ticks:{ font:{ size:9 }, color:P.ink }, grid:{ display:false } }, y:{ display:false } } }
    });

    drawChart("soldeChart", {
      type:"line",
      data:{ labels:labels, datasets:[{ data:solde, borderColor:P.credit, backgroundColor:hexA(P.credit, .12),
        borderWidth:2, pointRadius:2, tension:.3, fill:true }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false,
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:function (c) { return fmt(c.parsed.y); } } } },
        scales:{ x:{ ticks:{ font:{ size:9 }, color:P.ink }, grid:{ display:false } }, y:{ display:false } } }
    });

    var totals = {};
    catsOf("sortie").forEach(function (c) {
      var s = 0;
      act.forEach(function (m) { s += cellVal(getEntries(chartYear, m)[c.id]); });
      if (s > 0) totals[c.name] = s;
    });
    var pairs = Object.keys(totals).map(function (k) { return [k, totals[k]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
    var top = pairs.slice(0, 5), rest = pairs.slice(5);
    var restSum = rest.reduce(function (a, p) { return a + p[1]; }, 0);
    if (restSum > 0) top.push(["Autres", restSum]);
    var grand = top.reduce(function (a, p) { return a + p[1]; }, 0) || 1;

    drawChart("donutChart", {
      type:"doughnut",
      data:{ labels: top.map(function (p) { return p[0]; }),
        datasets:[{ data: top.map(function (p) { return p[1]; }),
          backgroundColor: top.map(function (_, i) { return DONUT[i % DONUT.length]; }),
          borderColor:P.page, borderWidth:2 }] },
      options:{ responsive:true, maintainAspectRatio:false, animation:false, cutout:"62%",
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:function (c) { return c.label + " : " + fmt(c.parsed); } } } } }
    });

    var lg = $("donutLegend");
    lg.innerHTML = top.length
      ? top.map(function (p, i) {
          return '<span><span class="dot" style="background:' + DONUT[i % DONUT.length] + '"></span>' +
            esc(p[0]) + " " + Math.round(p[1] / grand * 100) + "%</span>";
        }).join("")
      : '<span class="muted">Aucune sortie sur la période.</span>';
  }

  $("mpSummary").addEventListener("click", function () {
    var body = $("mpBody"), chev = $("mpChev");
    var hidden = body.classList.toggle("hidden");
    chev.className = "ti " + (hidden ? "ti-chevron-down" : "ti-chevron-up");
  });
  $("mpAll").addEventListener("click", function () { selectedMonths = null; renderMonthGrid(); renderMPSummary(); renderChartsData(); });
  $("mpNone").addEventListener("click", function () { selectedMonths = []; renderMonthGrid(); renderMPSummary(); renderChartsData(); });

  /* ---------------------------------------------------------
     Sélecteurs
     --------------------------------------------------------- */
  $("catSelect").addEventListener("click", function () {
    var l = $("catPickList");
    l.innerHTML = "";
    state.categories.forEach(function (cat) {
      var b = document.createElement("button");
      if (cat.id === selectedCat) b.classList.add("on");
      b.innerHTML = '<span><span class="pill ' + cat.type + '">' + (cat.type === "entree" ? "E" : "S") + "</span>" + esc(cat.name) + "</span>";
      b.addEventListener("click", function () { selectedCat = cat.id; close("overlayCatPick"); renderCat(); });
      l.appendChild(b);
    });
    open("overlayCatPick");
  });
  $("closeCatPick").addEventListener("click", function () { close("overlayCatPick"); });

  $("yearSelect").addEventListener("click", function () {
    var l = $("yearPickList");
    l.innerHTML = "";
    knownYears().forEach(function (y) {
      var b = document.createElement("button");
      if (y === chartYear) b.classList.add("on");
      b.innerHTML = "<span>" + y + "</span>" + (y === chartYear ? '<i class="ti ti-check"></i>' : "");
      b.addEventListener("click", function () { chartYear = y; close("overlayYearPick"); renderCharts(); });
      l.appendChild(b);
    });
    open("overlayYearPick");
  });
  $("closeYearPick").addEventListener("click", function () { close("overlayYearPick"); });

  $("pickMonth").addEventListener("click", function () {
    var g = $("monthPickGrid");
    g.innerHTML = "";
    MONTHS.forEach(function (nm, i) {
      var b = document.createElement("button");
      b.textContent = nm.charAt(0).toUpperCase() + nm.slice(1);
      if (i === cursor.month) b.classList.add("on");
      b.addEventListener("click", function () { cursor.month = i; close("overlayMonthPick"); renderMonth(); });
      g.appendChild(b);
    });
    open("overlayMonthPick");
  });
  $("closeMonthPick").addEventListener("click", function () { close("overlayMonthPick"); });

  $("pickYear").addEventListener("click", function () {
    var l = $("yearPickList");
    l.innerHTML = "";
    var years = knownYears();
    for (var d = -1; d <= 2; d++) { var yy = cursor.year + d; if (years.indexOf(yy) < 0) years.push(yy); }
    years.sort(function (a, b) { return b - a; });
    years.forEach(function (y) {
      var b = document.createElement("button");
      if (y === cursor.year) b.classList.add("on");
      b.innerHTML = "<span>" + y + "</span>" + (y === cursor.year ? '<i class="ti ti-check"></i>' : "");
      b.addEventListener("click", function () { cursor.year = y; close("overlayYearPick"); renderMonth(); });
      l.appendChild(b);
    });
    open("overlayYearPick");
  });

  /* ---------------------------------------------------------
     Menu Options
     --------------------------------------------------------- */
  $("screenAction").addEventListener("click", function () { open("overlayMenu"); });
  $("closeMenu").addEventListener("click", function () { close("overlayMenu"); });
  $("undoBtn").addEventListener("click", undo);

  Array.prototype.forEach.call(document.querySelectorAll("#themeSeg button"), function (b) {
    b.addEventListener("click", function () {
      state.settings.theme = b.getAttribute("data-theme");
      save(); applyTheme();
    });
  });

  function bindSwitch(id, getter, setter) {
    var el = $(id);
    function sync() { el.classList.toggle("on", !!getter()); }
    el.addEventListener("click", function (e) { e.preventDefault(); setter(!getter()); sync(); });
    sync();
    return sync;
  }
  var syncDelta = bindSwitch("swDelta",
    function () { return state.settings.showDelta !== false; },
    function (v) { state.settings.showDelta = v; save(); if (currentView === "month") renderMonth(); });
  var syncSearch = bindSwitch("swSearch",
    function () { return state.settings.showSearch !== false; },
    function (v) {
      state.settings.showSearch = v; save();
      if (!v) { searchTerm = ""; $("searchInput").value = ""; }
      if (currentView === "month") renderMonth();
    });

  /* ---------------------------------------------------------
     Catégories
     --------------------------------------------------------- */
  var pendingType = "entree";
  Array.prototype.forEach.call(document.querySelectorAll(".add-cat"), function (btn) {
    btn.addEventListener("click", function () {
      pendingType = btn.getAttribute("data-type");
      Array.prototype.forEach.call(document.querySelectorAll("#overlayNewCat .type-toggle button"), function (b) {
        b.classList.toggle("active", b.getAttribute("data-type") === pendingType);
      });
      $("newCatName").value = ""; $("newCatBudget").value = "";
      open("overlayNewCat");
      setTimeout(function () { $("newCatName").focus(); }, 60);
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#overlayNewCat .type-toggle button"), function (b) {
    b.addEventListener("click", function () {
      pendingType = b.getAttribute("data-type");
      Array.prototype.forEach.call(document.querySelectorAll("#overlayNewCat .type-toggle button"), function (x) {
        x.classList.toggle("active", x === b);
      });
    });
  });
  $("cancelNewCat").addEventListener("click", function () { close("overlayNewCat"); });
  $("confirmNewCat").addEventListener("click", function () {
    var name = $("newCatName").value.trim();
    if (!name) { toast("Donne un nom à la ligne."); return; }
    var budget = parseFloat(String($("newCatBudget").value).replace(",", "."));
    pushUndo();
    state.categories.push({ id:"c" + Date.now().toString(36), name:name, type:pendingType,
      budget: isNaN(budget) || budget <= 0 ? null : round2(budget) });
    save(); close("overlayNewCat"); renderMonth();
    toast("« " + name + " » ajoutée.");
  });
  $("newCatName").addEventListener("keydown", function (e) { if (e.key === "Enter") $("confirmNewCat").click(); });

  function renderCatManage() {
    var c = $("catList");
    c.innerHTML = "";
    state.categories.forEach(function (cat) {
      var sib = catsOf(cat.type), pos = sib.indexOf(cat);
      var row = document.createElement("div");
      row.className = "cat-manage-row";
      row.innerHTML =
        '<span class="tag ' + cat.type + '">' + (cat.type === "entree" ? "Entrée" : "Sortie") + "</span>" +
        '<span class="cname" data-id="' + cat.id + '" contenteditable="true" role="textbox">' + esc(cat.name) + "</span>" +
        '<div class="reorder-btns">' +
          '<button class="reorder-btn" data-up="' + cat.id + '"' + (pos === 0 ? " disabled" : "") + ' aria-label="Monter"><i class="ti ti-chevron-up"></i></button>' +
          '<button class="reorder-btn" data-down="' + cat.id + '"' + (pos === sib.length - 1 ? " disabled" : "") + ' aria-label="Descendre"><i class="ti ti-chevron-down"></i></button>' +
        "</div>" +
        '<button class="del-btn" data-del="' + cat.id + '"><i class="ti ti-trash"></i>Supprimer</button>';
      c.appendChild(row);
    });
  }
  function moveCat(id, dir) {
    var idx = state.categories.findIndex(function (c) { return c.id === id; });
    if (idx < 0) return;
    var cat = state.categories[idx], j = idx;
    do { j += dir; } while (j >= 0 && j < state.categories.length && state.categories[j].type !== cat.type);
    if (j < 0 || j >= state.categories.length) return;
    pushUndo();
    state.categories.splice(idx, 1);
    state.categories.splice(j, 0, cat);
    save(); renderCatManage();
  }
  $("menuCategories").addEventListener("click", function () { close("overlayMenu"); renderCatManage(); open("overlayManageCat"); });
  $("closeManageCat").addEventListener("click", function () {
    var changed = false;
    Array.prototype.forEach.call(document.querySelectorAll("#catList .cname"), function (el) {
      var id = el.getAttribute("data-id"), nn = el.textContent.trim();
      var cat = state.categories.find(function (c) { return c.id === id; });
      if (cat && nn && cat.name !== nn) { cat.name = nn; changed = true; }
    });
    if (changed) save();
    close("overlayManageCat"); render();
  });
  $("catList").addEventListener("click", function (e) {
    var up = e.target.closest("[data-up]"), down = e.target.closest("[data-down]");
    if (up && !up.disabled) { moveCat(up.getAttribute("data-up"), -1); return; }
    if (down && !down.disabled) { moveCat(down.getAttribute("data-down"), 1); return; }
    var t = e.target.closest("[data-del]");
    if (!t) return;
    var id = t.getAttribute("data-del");
    var cat = state.categories.find(function (c) { return c.id === id; });
    if (!cat) return;
    if (!confirm("Supprimer « " + cat.name + " » et tous ses montants sur tous les mois ?")) return;
    pushUndo();
    state.categories = state.categories.filter(function (c) { return c.id !== id; });
    Object.keys(state.entries).forEach(function (k) { delete state.entries[k][id]; });
    if (selectedCat === id) selectedCat = null;
    save(); renderCatManage();
    toast("Catégorie supprimée.", "Annuler", undo);
  });

  /* ---------------------------------------------------------
     Budgets
     --------------------------------------------------------- */
  function openBudgets() {
    var c = $("budgetEditList");
    c.innerHTML = state.categories.map(function (cat) {
      return '<div class="bud-edit-row"><span class="nm"><span class="pill ' + cat.type + '">' +
        (cat.type === "entree" ? "E" : "S") + "</span>" + esc(cat.name) + "</span>" +
        '<input type="number" step="0.01" inputmode="decimal" placeholder="—" data-bud="' + cat.id +
        '" value="' + (cat.budget > 0 ? cat.budget : "") + '"></div>';
    }).join("");
    open("overlayBudgets");
  }
  $("menuBudgets").addEventListener("click", function () { close("overlayMenu"); openBudgets(); });
  $("budgetEdit").addEventListener("click", openBudgets);
  $("cancelBudgets").addEventListener("click", function () { close("overlayBudgets"); });
  $("confirmBudgets").addEventListener("click", function () {
    pushUndo();
    Array.prototype.forEach.call(document.querySelectorAll("[data-bud]"), function (inp) {
      var cat = state.categories.find(function (c) { return c.id === inp.getAttribute("data-bud"); });
      if (!cat) return;
      var v = parseFloat(String(inp.value).replace(",", "."));
      cat.budget = isNaN(v) || v <= 0 ? null : round2(v);
    });
    save(); close("overlayBudgets"); render();
    toast("Budgets enregistrés.");
  });

  /* ---------------------------------------------------------
     Solde de départ / réinitialisation
     --------------------------------------------------------- */
  $("menuSolde").addEventListener("click", function () {
    close("overlayMenu");
    $("soldeInitial").value = state.soldeInitial || 0;
    open("overlaySolde");
  });
  $("cancelSolde").addEventListener("click", function () { close("overlaySolde"); });
  $("confirmSolde").addEventListener("click", function () {
    var v = parseFloat(String($("soldeInitial").value).replace(",", "."));
    pushUndo();
    state.soldeInitial = isNaN(v) ? 0 : round2(v);
    save(); close("overlaySolde"); render();
  });
  $("soldeInitial").addEventListener("keydown", function (e) { if (e.key === "Enter") $("confirmSolde").click(); });

  $("menuReset").addEventListener("click", function () {
    close("overlayMenu");
    $("resetTitle").textContent = "Réinitialiser " + MONTHS[cursor.month] + " " + cursor.year + " ?";
    open("overlayReset");
  });
  $("cancelReset").addEventListener("click", function () { close("overlayReset"); });
  $("confirmReset").addEventListener("click", function () {
    pushUndo();
    state.entries[key(cursor.year, cursor.month)] = {};
    save(); close("overlayReset"); render();
    toast("Montants du mois effacés.", "Annuler", undo);
  });

  /* ---------------------------------------------------------
     Duplication / reprise du mois précédent
     --------------------------------------------------------- */
  var dupTargets = [], dupOverwrite = true, dupChecks = false;

  $("openDup").addEventListener("click", function () {
    dupTargets = []; dupOverwrite = true; dupChecks = false;
    $("dupTitle").textContent = "Dupliquer " + MONTHS[cursor.month] + " " + cursor.year;
    var nb = Object.keys(getEntries(cursor.year, cursor.month)).length;
    $("dupDesc").textContent = nb + " ligne(s) saisie(s) seront copiées vers les mois choisis.";
    var sel = $("dupYear");
    sel.innerHTML = "";
    knownYears().concat([cursor.year + 1]).filter(function (v, i, a) { return a.indexOf(v) === i; })
      .sort(function (a, b) { return a - b; })
      .forEach(function (y) {
        var o = document.createElement("option");
        o.value = y; o.textContent = y;
        if (y === cursor.year) o.selected = true;
        sel.appendChild(o);
      });
    $("dupOverwrite").classList.toggle("on", dupOverwrite);
    $("dupKeepChecks").classList.toggle("on", dupChecks);
    renderDupGrid(); updateDupBtn(); open("overlayDup");
  });
  function renderDupGrid() {
    var g = $("dupGrid");
    g.innerHTML = "";
    var ty = parseInt($("dupYear").value, 10);
    MSHORT.forEach(function (ms, i) {
      var b = document.createElement("button");
      b.textContent = ms;
      if (ty === cursor.year && i === cursor.month) { b.classList.add("self"); b.disabled = true; }
      else {
        if (dupTargets.indexOf(i) >= 0) b.classList.add("on");
        b.addEventListener("click", function () {
          var idx = dupTargets.indexOf(i);
          if (idx >= 0) dupTargets.splice(idx, 1); else dupTargets.push(i);
          renderDupGrid(); updateDupBtn();
        });
      }
      g.appendChild(b);
    });
  }
  function updateDupBtn() {
    $("confirmDup").textContent = dupTargets.length ? "Dupliquer vers " + dupTargets.length + " mois" : "Dupliquer";
  }
  $("dupYear").addEventListener("change", function () { dupTargets = []; renderDupGrid(); updateDupBtn(); });
  $("dupOverwrite").addEventListener("click", function (e) { e.preventDefault(); dupOverwrite = !dupOverwrite; this.classList.toggle("on", dupOverwrite); });
  $("dupKeepChecks").addEventListener("click", function (e) { e.preventDefault(); dupChecks = !dupChecks; this.classList.toggle("on", dupChecks); });
  $("cancelDup").addEventListener("click", function () { close("overlayDup"); });
  $("confirmDup").addEventListener("click", function () {
    if (!dupTargets.length) { close("overlayDup"); return; }
    var ty = parseInt($("dupYear").value, 10), src = getEntries(cursor.year, cursor.month);
    pushUndo();
    dupTargets.forEach(function (m) {
      var dst = getEntries(ty, m);
      Object.keys(src).forEach(function (catId) {
        if (!dupOverwrite && dst[catId] !== undefined) return;
        var s = src[catId];
        dst[catId] = {
          raw: s.raw, val: s.val, done: dupChecks ? !!s.done : false,
          items: (s.items || []).map(function (i) { return { id: uid(), label: i.label, amount: i.amount }; })
        };
      });
    });
    save(); close("overlayDup"); render();
    toast("Copié vers " + dupTargets.length + " mois.", "Annuler", undo);
  });

  $("openTemplates").addEventListener("click", function () {
    var p = prevOf(cursor.year, cursor.month);
    var src = state.entries[key(p.year, p.month)] || {};
    var ids = Object.keys(src).filter(function (id) { return hasAmount(src[id]); });
    if (!ids.length) { toast("Aucun montant sur " + MONTHS[p.month] + " à reprendre."); return; }
    var dst = getEntries(cursor.year, cursor.month), n = 0;
    pushUndo();
    ids.forEach(function (id) {
      if (hasAmount(dst[id])) return;
      var s = src[id];
      dst[id] = { raw:s.raw, val:s.val, done:false,
        items:(s.items || []).map(function (i) { return { id: uid(), label: i.label, amount: i.amount }; }) };
      n++;
    });
    save(); renderMonth();
    toast(n ? n + " ligne(s) reprise(s) de " + MONTHS[p.month] + "." : "Toutes les lignes sont déjà saisies.", n ? "Annuler" : null, undo);
  });

  /* ---------------------------------------------------------
     Export / import
     --------------------------------------------------------- */
  function pad2(n) { return String(n).padStart(2, "0"); }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }
  function download(blob, filename) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCSV() {
    var rows = [["mois","categorie","type","montant","calcul","realise","budget","detail"]];
    Object.keys(state.entries).sort().forEach(function (k) {
      var e = state.entries[k];
      Object.keys(e).forEach(function (catId) {
        var cat = state.categories.find(function (c) { return c.id === catId; });
        var cell = e[catId];
        var detail = (cell.items || []).map(function (i) { return i.label + "=" + i.amount; }).join(" | ");
        rows.push([k, cat ? cat.name : catId, cat ? cat.type : "",
          String(cellVal(cell)).replace(".", ","), String(cell.raw),
          cell.done ? "oui" : "non", cat && cat.budget ? String(cat.budget).replace(".", ",") : "", detail]);
      });
    });
    var csv = rows.map(function (r) {
      return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(";");
    }).join("\n");
    download(new Blob(["\ufeff" + csv], { type:"text/csv;charset=utf-8;" }), "carnet-de-comptes-" + stamp() + ".csv");
  }
  $("menuExport").addEventListener("click", function () { close("overlayMenu"); exportCSV(); });
  $("menuImport").addEventListener("click", function () { close("overlayMenu"); $("importFile").click(); });

  $("importFile").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function (ev) {
      try {
        var text = String(ev.target.result).replace(/^\ufeff/, "");
        var lines = text.split(/\r?\n/).filter(Boolean);
        lines.shift();
        var n = 0;
        pushUndo();
        lines.forEach(function (line) {
          var cells = line.split(";").map(function (c) { return c.replace(/^"|"$/g, "").replace(/""/g, '"'); });
          var mois = cells[0], name = cells[1], type = cells[2], montant = cells[3], calcul = cells[4], realise = cells[5];
          if (!mois || !name || !/^\d{4}-\d{2}$/.test(mois)) return;
          var cat = state.categories.find(function (c) { return c.name === name && c.type === type; });
          if (!cat) {
            cat = { id:"c" + Date.now().toString(36) + Math.random().toString(36).slice(2,6), name:name,
              type: type === "entree" ? "entree" : "sortie", budget:null };
            state.categories.push(cat);
          }
          if (!state.entries[mois]) state.entries[mois] = {};
          var num = parseFloat(String(montant).replace(",", "."));
          if (isNaN(num)) return;
          state.entries[mois][cat.id] = { raw: calcul ? calcul : String(num), val: round2(num), done: realise === "oui", items: [] };
          n++;
        });
        save(); render();
        toast(n + " montant(s) importé(s).", "Annuler", undo);
      } catch (err) {
        toast("Le fichier CSV n'a pas pu être lu.");
      }
      e.target.value = "";
    };
    r.readAsText(f);
  });

  function backupJSON() {
    var payload = { app:"carnet-de-comptes", version:5, exportedAt:new Date().toISOString(), data:state };
    download(new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" }), "carnet-de-comptes-" + stamp() + ".json");
    state.settings.lastBackup = new Date().toISOString();
    save();
    toast("Sauvegarde enregistrée dans tes fichiers.");
  }
  $("menuBackup").addEventListener("click", function () { close("overlayMenu"); backupJSON(); });
  $("syncBackup").addEventListener("click", function () { close("overlaySync"); backupJSON(); });
  $("menuRestore").addEventListener("click", function () { close("overlayMenu"); $("restoreFile").click(); });

  $("restoreFile").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function (ev) {
      try {
        var obj = JSON.parse(String(ev.target.result));
        var data = obj && obj.data ? obj.data : obj;
        if (!data || typeof data !== "object" || !data.categories || !data.entries) throw new Error("format");
        var nMonths = Object.keys(data.entries).length;
        if (!confirm("Remplacer les données de cet appareil par la sauvegarde (" + nMonths + " mois) ?")) { e.target.value = ""; return; }
        pushUndo();
        state = normalize(data);
        save(); selectedCat = null; applyTheme(); syncDelta(); syncSearch(); render();
        toast("Sauvegarde restaurée.", "Annuler", undo);
      } catch (err) {
        toast("Ce fichier n'est pas une sauvegarde valide du carnet.");
      }
      e.target.value = "";
    };
    r.readAsText(f);
  });

  /* ---------------------------------------------------------
     Installation
     --------------------------------------------------------- */
  var deferredPrompt = null;
  var ua = navigator.userAgent || "";
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isMac = /Macintosh/.test(ua) && !isIOS;
  var isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  function installSteps() {
    if (isIOS) return '<p class="desc">Sur iPhone ou iPad, dans <b>Safari</b> :</p>' +
      '<div class="detail-row"><span>1. Touche le bouton <b>Partager</b> (carré avec une flèche)</span></div>' +
      '<div class="detail-row"><span>2. Fais défiler puis choisis <b>Sur l\'écran d\'accueil</b></span></div>' +
      '<div class="detail-row"><span>3. Touche <b>Ajouter</b></span></div>';
    if (isMac) return '<p class="desc">Sur Mac, dans <b>Safari 17 ou plus récent</b> :</p>' +
      '<div class="detail-row"><span>1. Menu <b>Fichier</b> → <b>Ajouter au Dock…</b></span></div>' +
      '<div class="detail-row"><span>2. Valide le nom puis <b>Ajouter</b></span></div>' +
      '<div class="detail-row"><span>3. L\'app s\'ouvre depuis le Dock, dans sa propre fenêtre</span></div>' +
      '<p class="hint">Avec Chrome ou Edge : icône d\'installation à droite de la barre d\'adresse.</p>';
    return '<p class="desc">Depuis le menu du navigateur, choisis <b>Installer l\'application</b>.</p>';
  }
  function openInstall() {
    $("installBody").innerHTML = standalone
      ? '<p class="desc">L\'app est déjà installée : tu l\'utilises en mode plein écran.</p>'
      : installSteps();
    $("doInstall").hidden = !deferredPrompt;
    open("overlayInstall");
  }
  $("menuInstall").addEventListener("click", function () { close("overlayMenu"); openInstall(); });
  $("closeInstall").addEventListener("click", function () { close("overlayInstall"); });
  $("doInstall").addEventListener("click", function () {
    if (!deferredPrompt) return;
    close("overlayInstall");
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
  });
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); deferredPrompt = e; showInstallBar(); });

  var installBarReady = false;
  function showInstallBar() {
    if (standalone || installBarReady) return;
    try { if (localStorage.getItem(INSTALL_HIDE) === "1") return; } catch (e) {}
    installBarReady = true;
    var bar = $("installBar");
    $("installBarText").innerHTML = isIOS
      ? "Ajoute le carnet à ton écran d'accueil : <b>Partager</b> → <b>Sur l'écran d'accueil</b>."
      : (isMac && isSafari ? "Garde le carnet dans ton Dock : menu <b>Fichier</b> → <b>Ajouter au Dock…</b>"
                           : "Installe le carnet pour l'ouvrir comme une vraie app.");
    bar.classList.add("show");
    bar.addEventListener("click", function (e) { if (e.target.closest("#installBarClose")) return; openInstall(); });
  }
  $("installBarClose").addEventListener("click", function (e) {
    e.stopPropagation();
    $("installBar").classList.remove("show");
    try { localStorage.setItem(INSTALL_HIDE, "1"); } catch (err) {}
  });

  /* ---------------------------------------------------------
     Synchronisation / à propos
     --------------------------------------------------------- */
  $("menuSync").addEventListener("click", function () { close("overlayMenu"); open("overlaySync"); });
  $("closeSync").addEventListener("click", function () { close("overlaySync"); });

  $("menuAbout").addEventListener("click", function () {
    close("overlayMenu");
    $("appVersion").textContent = APP_VERSION;
    var months = Object.keys(state.entries).filter(function (k) {
      return Object.keys(state.entries[k]).length > 0;
    }).length;
    var cells = 0, items = 0;
    Object.keys(state.entries).forEach(function (k) {
      Object.keys(state.entries[k]).forEach(function (id) {
        cells++; items += (state.entries[k][id].items || []).length;
      });
    });
    var lb = state.settings.lastBackup ? new Date(state.settings.lastBackup).toLocaleDateString("fr-FR") : "jamais";
    $("aboutStats").innerHTML =
      '<div class="bilan">' +
        '<div class="b"><p class="k">Catégories</p><p class="v">' + state.categories.length + "</p></div>" +
        '<div class="b"><p class="k">Mois renseignés</p><p class="v">' + months + "</p></div>" +
        '<div class="b"><p class="k">Montants saisis</p><p class="v">' + cells + "</p></div>" +
        '<div class="b"><p class="k">Lignes de détail</p><p class="v">' + items + "</p></div>" +
      "</div>" +
      '<div class="detail-row" style="margin-top:12px;"><span>Dernière sauvegarde</span><span class="val">' + lb + "</span></div>";
    var st = $("aboutStorage");
    st.textContent = "Stockage : navigateur de cet appareil.";
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        var used = est.usage ? (est.usage / 1024).toFixed(0) + " Ko" : "—";
        st.textContent = "Stockage : navigateur de cet appareil (" + used + " utilisés).";
      }).catch(function () {});
    }
    open("overlayAbout");
  });
  $("closeAbout").addEventListener("click", function () { close("overlayAbout"); });
  $("wipeAll").addEventListener("click", function () {
    if (!confirm("Effacer TOUTES les données du carnet sur cet appareil ?")) return;
    if (!confirm("Cette action est définitive. As-tu fait une sauvegarde ?")) return;
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_V3); localStorage.removeItem(LEGACY_V2); } catch (e) {}
    location.reload();
  });

  /* ---------------------------------------------------------
     Clavier
     --------------------------------------------------------- */
  document.addEventListener("keydown", function (e) {
    var ov = topOverlay();
    if (e.key === "Escape" && ov) { dismissOverlay(ov); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (ov) return;
    var ae = document.activeElement;
    var tag = (ae && ae.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (ae && ae.isContentEditable)) return;
    if (currentView === "month" && e.key === "ArrowLeft") $("prevMonth").click();
    else if (currentView === "month" && e.key === "ArrowRight") $("nextMonth").click();
    else if (e.key >= "1" && e.key <= "4") go(["home","month","cat","charts"][+e.key - 1]);
  });

  /* ---------------------------------------------------------
     Service worker
     --------------------------------------------------------- */
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) {
        function offer(worker) {
          toast("Nouvelle version disponible.", "Mettre à jour", function () {
            worker.postMessage({ type:"SKIP_WAITING" });
          }, true);
        }
        if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
        reg.addEventListener("updatefound", function () {
          var w = reg.installing;
          if (!w) return;
          w.addEventListener("statechange", function () {
            if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
          });
        });
        setInterval(function () { reg.update().catch(function () {}); }, 60 * 60 * 1000);
      }).catch(function () {});
      var reloading = false;
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    });
  }

  /* ---------------------------------------------------------
     Démarrage
     --------------------------------------------------------- */
  function backupReminder() {
    var hasData = Object.keys(state.entries).some(function (k) { return Object.keys(state.entries[k]).length; });
    if (!hasData) return;
    var last = state.settings.lastBackup ? new Date(state.settings.lastBackup).getTime() : 0;
    var days = (Date.now() - last) / 86400000;
    if (days > 30) {
      setTimeout(function () {
        toast(last ? "Dernière sauvegarde il y a plus d'un mois." : "Pense à sauvegarder ton carnet.", "Sauvegarder", backupJSON);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { $("toast").classList.remove("show"); }, 12000);
      }, 2500);
    }
  }

  function init() {
    // Données reprises d'une version précédente : on les réenregistre tout de
    // suite au nouveau format, pour ne pas dépendre indéfiniment de l'ancienne clé.
    try { if (!localStorage.getItem(STORAGE_KEY)) save(); } catch (e) {}
    applyTheme();
    showInstallBar();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(function (p) {
        if (!p) navigator.storage.persist().catch(function () {});
      }).catch(function () {});
    }
    $("brandSub").textContent = standalone ? "Carnet personnel — hors ligne" : "Tenu en local sur cet appareil";
    var params = new URLSearchParams(location.search);
    var start = params.get("ecran");
    go(TITLES[start] ? start : "home");
    backupReminder();
  }

  init();
})();
