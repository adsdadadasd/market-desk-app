(function () {
  'use strict';

  var DATA = JSON.parse(document.getElementById('data').textContent);

  // ── 名詞庫 ────────────────────────────────────────────────────────────
  var GLOSSARY = DATA.glossary || [];
  var TERM_MAP = {};
  GLOSSARY.forEach(function (g) { TERM_MAP[g.id] = g; });

  function rxEscape(text) {
    var out = "";
    var special = "^$.*+?()[]{}|/";
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      out += special.indexOf(c) >= 0 ? "\\" + c : c;
    }
    return out;
  }

  var TERM_RE = (function () {
    var parts = [];
    GLOSSARY.forEach(function (g) {
      [g.term].concat(g.aliases || []).forEach(function (t) {
        if (!t) return;
        var safe = rxEscape(t);
        var ascii = /^[\x20-\x7E]+$/.test(t);
        parts.push({ p: ascii ? '(?<![A-Za-z0-9])' + safe + '(?![A-Za-z0-9])' : safe, n: t.length });
      });
    });
    if (!parts.length) return null;
    parts.sort(function (a, b) { return b.n - a.n; });
    return new RegExp('(' + parts.map(function (x) { return x.p; }).join('|') + ')', 'gi');
  })();

  function termKey(matched) {
    var low = matched.toLowerCase();
    for (var i = 0; i < GLOSSARY.length; i++) {
      var g = GLOSSARY[i];
      if (g.term.toLowerCase() === low) return g.id;
      var al = g.aliases || [];
      for (var j = 0; j < al.length; j++) if (al[j].toLowerCase() === low) return g.id;
    }
    return null;
  }

  function linkTerms(text) {
    if (!TERM_RE || !text) return text;
    return text.replace(TERM_RE, function (m) {
      var key = termKey(m);
      if (!key) return m;
      return '<button type="button" class="term" data-t="' + key + '">' + m + '</button>';
    });
  }

  function explain(text) {
    return '<div class="explain"><span class="explain-label">人話</span>' + esc(text) + '</div>';
  }

  function termCard(g) {
    var alias = (g.aliases || []).length ? '<div class="tt-alias">' + g.aliases.map(esc).join(' · ') + '</div>' : '';
    return '<div class="tt-cat">' + esc(g.cat) + '</div>' +
      '<h3 class="tt-term">' + esc(g.term) + '</h3>' + alias +
      '<div class="tt-plain"><span class="tt-label">人話</span><p>' + esc(g.plain) + '</p></div>' +
      '<div class="tt-pro"><span class="tt-label">專業</span><p>' + esc(g.pro) + '</p></div>';
  }

  function openTerm(id) {
    var g = TERM_MAP[id];
    if (!g) return;
    var m = document.getElementById('term-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'term-modal';
      m.className = 'modal';
      m.hidden = true;
      m.innerHTML = '<div class="modal-backdrop" data-close="1"></div>' +
        '<div class="modal-card" role="dialog" aria-modal="true">' +
        '<button type="button" class="modal-close" data-close="1" aria-label="關閉">✕</button>' +
        '<div class="modal-body"></div></div>';
      document.body.appendChild(m);
    }
    m.querySelector('.modal-body').innerHTML = termCard(g);
    m.hidden = false;
  }

  function closeTerm() {
    var m = document.getElementById('term-modal');
    if (m) m.hidden = true;
  }
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  var HKT = 'Asia/Hong_Kong';

  function timeHKT(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('zh-HK', { timeZone: HKT, hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) { return ''; }
  }

  function dateTimeHKT(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      var day = d.toLocaleDateString('zh-HK', { timeZone: HKT, month: '2-digit', day: '2-digit' });
      return day + ' ' + timeHKT(iso);
    } catch (e) { return ''; }
  }

  function weekday(d) {
    try {
      return new Date(d + 'T12:00:00+08:00').toLocaleDateString('zh-HK', { weekday: 'short' });
    } catch (e) { return ''; }
  }

  function pct(v) {
    if (v == null || isNaN(v)) return '';
    var cls = v >= 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + Number(v).toFixed(1) + '%</span>';
  }

  // ── 極簡 markdown（標題、粗體、清單、表格、引用、連結）──────────────
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  }

  function md2html(md) {
    var lines = String(md || '').replace(/\r/g, '').split('\n');
    var out = [];
    var i = 0;
    while (i < lines.length) {
      var l = lines[i];
      if (/^\s*$/.test(l)) { i++; continue; }

      var h = l.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        var lv = h[1].length;
        out.push('<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>');
        i++; continue;
      }

      if (/^\|/.test(l) && /^\|[\s:|\-]+\|?\s*$/.test(lines[i + 1] || '')) {
        var head = l.split('|').slice(1, -1).map(function (c) { return '<th>' + inline(c.trim()) + '</th>'; }).join('');
        var rows = [];
        i += 2;
        while (i < lines.length && /^\|/.test(lines[i])) {
          rows.push('<tr>' + lines[i].split('|').slice(1, -1).map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('') + '</tr>');
          i++;
        }
        out.push('<table><thead><tr>' + head + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>');
        continue;
      }

      if (/^\s*[-*]\s+/.test(l)) {
        var items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push('<li>' + inline(lines[i].replace(/^\s*[-*]\s+/, '')) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }

      if (/^>\s?/.test(l)) {
        var quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + inline(quote.join(' ')) + '</blockquote>');
        continue;
      }

      out.push('<p>' + inline(l) + '</p>');
      i++;
    }
    return out.join('\n');
  }

  // ── 小元件 ────────────────────────────────────────────────────────────
  function chip(t) {
    return '<a class="chip" href="#/s/' + encodeURIComponent(t) + '">' + esc(t) + '</a>';
  }

  function newsRow(it) {
    var cls = it.s >= 8 ? 'hi' : it.s >= 5 ? 'mid' : '';
    var chips = (it.tk || []).map(chip).join('');
    var extra = '';
    if (it.sum) extra += '<div class="nsum">' + esc(it.sum) + '</div>';
    if (it.why) extra += '<div class="nwhy">' + esc(it.why) + (it.m ? ' <span class="nauto">AI</span>' : it.a ? ' <span class="nauto">自動</span>' : '') + '</div>';
    return '<div class="row" data-tk="' + esc((it.tk || []).join(',')) + '" data-s="' + (it.s || 0) + '" data-p="' + esc(it.p || '') + '">' +
      '<span class="score ' + cls + '">' + it.s + '</span>' +
      '<div class="rowmain">' +
        '<a href="' + esc(it.u) + '" target="_blank" rel="noreferrer">' + esc(it.t) + '</a>' +
        '<div class="meta"><span>' + esc(it.dom || '') + '</span><span>' + dateTimeHKT(it.p) + '</span>' + chips + '</div>' +
        extra +
      '</div></div>';
  }

  function newsList(items, limit) {
    var arr = (items || []).slice(0, limit || (items || []).length);
    if (!arr.length) return '<div class="empty">沒有紀錄。</div>';
    return arr.map(newsRow).join('');
  }

  function empty(msg) { return '<div class="empty">' + esc(msg) + '</div>'; }

  function findNode(node, p) {
    if (!node) return null;
    if (node.p === p) return node;
    for (var i = 0; i < (node.c || []).length; i++) {
      var hit = findNode(node.c[i], p);
      if (hit) return hit;
    }
    return null;
  }

  function breadcrumb(segs) {
    var parts = ['<a href="#/">首頁</a>'];
    var acc = [];
    for (var i = 0; i < segs.length; i++) {
      acc.push(encodeURIComponent(segs[i]));
      parts.push('<a href="#/c/' + acc.join('/') + '">' + esc(segs[i]) + '</a>');
    }
    return '<div class="crumb">' + parts.join(' › ') + '</div>';
  }

  // ── 側邊欄 ────────────────────────────────────────────────────────────
  var sideTab = 'cat';

  function treeHtml(node, depth) {
    var kids = node.c || [];
    var url = '#/c/' + node.p.split('/').map(encodeURIComponent).join('/');
    var label = '<a href="' + url + '">' + esc(node.n) + '</a>' + (node.cnt ? '<span class="cnt">' + node.cnt + '</span>' : '');
    if (!kids.length) return '<li>' + label + '</li>';
    return '<li><details' + (depth < 1 ? ' open' : '') + '><summary>' + label + '</summary><ul>' +
      kids.map(function (k) { return treeHtml(k, depth + 1); }).join('') + '</ul></details></li>';
  }

  function renderSide(activeDate, activePath) {
    var side = $('#side');
    var html = '<div class="tabs">' +
      '<button data-tab="cat" class="' + (sideTab === 'cat' ? 'on' : '') + '">分類</button>' +
      '<button data-tab="date" class="' + (sideTab === 'date' ? 'on' : '') + '">日期</button>' +
      '</div>';

    if (sideTab === 'cat') {
      html += '<button type="button" id="modeBtn" class="navlink modebtn"><span>掃描頻率</span><span class="cnt" id="modeVal">—</span></button>';
      html += '<a class="navlink" href="#/w"><span>推薦名單</span><span class="cnt">' + DATA.stocks.length + '</span></a>';
      html += '<a class="navlink" href="#/u"><span>股票庫</span><span class="cnt">≥ 2B</span></a>';
      html += '<a class="navlink" href="#/e"><span>ETF 庫</span><span class="cnt">≥ 1B</span></a>';
      html += '<a class="navlink" href="#/g"><span>名詞庫</span><span class="cnt">' + GLOSSARY.length + '</span></a>';
      html += '<div id="tree"><ul>' + treeHtml(DATA.tree, 0) + '</ul></div>';
    } else {
      html += '<ul id="dates">';
      for (var i = 0; i < DATA.days.length; i++) {
        var d = DATA.days[i];
        html += '<li><a class="' + (d.d === activeDate ? 'on' : '') + '" href="#/d/' + d.d + '">' +
          '<span>' + d.d + ' ' + weekday(d.d) + '</span>' +
          '<span class="n">' + (d.news ? d.news.length : 0) + ' 條</span></a></li>';
      }
      html += '</ul>';
    }
    side.innerHTML = html;
    void activePath;
  }

  // ── 視圖 ──────────────────────────────────────────────────────────────
  var MODE_API = 'http://127.0.0.1:7799';

  function bindMode() {
    var btn = document.getElementById('modeBtn');
    var val = document.getElementById('modeVal');
    if (!btn || !val) return;
    var tries = 0;

    function fmt(iso) {
      if (!iso) return '—';
      try { return new Date(iso).toLocaleTimeString('zh-HK', { hour12: false }); } catch (e) { return '—'; }
    }

    function paint(on) {
      val.textContent = on ? '運行中' : '已暫停';
      btn.classList.toggle('fast', !!on);
    }

    function connect() {
      fetch(MODE_API + '/status', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          paint(j.enabled);
          btn.disabled = false;
          btn.title = '新聞每 1 分鐘｜報價每 5 分鐘\n上次新聞 ' + fmt(j.lastNews) + '｜上次報價 ' + fmt(j.lastQuote) + '\n點一下可暫停或恢復';
          if (!btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () {
              fetch(MODE_API + '/mode', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ enabled: !btn.classList.contains('fast') }),
              }).then(function (r) { return r.json(); }).then(function (j2) { paint(j2.enabled); }).catch(function () {});
            });
          }
        })
        .catch(function () {
          val.textContent = '未連線';
          btn.disabled = true;
          if (tries++ < 6) setTimeout(connect, 10000);
        });
    }

    connect();
  }

  function sortDayNews(mode) {
    var box = document.querySelector('#daynews');
    if (!box) return;
    var rows = Array.prototype.slice.call(box.querySelectorAll('.row'));
    rows.sort(function (x, y) {
      if (mode === 'time') {
        return String(y.getAttribute('data-p') || '').localeCompare(String(x.getAttribute('data-p') || ''));
      }
      return Number(y.getAttribute('data-s') || 0) - Number(x.getAttribute('data-s') || 0);
    });
    rows.forEach(function (r) { box.appendChild(r); });
  }

  function bindDayTabs() {
    var sortBtns = document.querySelectorAll('.sortbtn');
    Array.prototype.forEach.call(sortBtns, function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-sort');
        Array.prototype.forEach.call(sortBtns, function (o) { o.classList.toggle('on', o === b); });
        sortDayNews(mode);
      });
    });

    var btns = document.querySelectorAll('.daytab');
    if (!btns.length) return;
    Array.prototype.forEach.call(btns, function (b) {
      b.addEventListener('click', function () {
        var f = b.getAttribute('data-f');
        Array.prototype.forEach.call(btns, function (o) { o.classList.toggle('on', o === b); });
        Array.prototype.forEach.call(document.querySelectorAll('#daynews .row'), function (row) {
          var tks = (row.getAttribute('data-tk') || '').split(',').filter(Boolean);
          var show = f === 'all' || (f === 'macro' ? tks.length === 0 : tks.indexOf(f) >= 0);
          row.style.display = show ? '' : 'none';
        });
      });
    });
  }

  function viewDate(date) {
    var day = null;
    for (var i = 0; i < DATA.days.length; i++) if (DATA.days[i].d === date) day = DATA.days[i];
    if (!day) day = DATA.days[0];
    if (!day) return empty('還沒有任何紀錄，等第一次採集完成。');

    var h = '<h1>' + day.d + ' <span class="badge">' + weekday(day.d) + '</span></h1>';
    h += '<div class="stats">新聞 ' + (day.news ? day.news.length : 0) + ' 條' +
      (day.alerts ? ' · 有警報紀錄' : '') +
      (day.digests && day.digests.length ? ' · ' + day.digests.length + ' 份簡報' : ' · 尚未產出簡報') + '</div>';

    if (day.digests && day.digests.length) {
      for (var j = 0; j < day.digests.length; j++) {
        h += '<h2>' + esc(day.digests[j].label || '簡報') + '</h2><div class="panel md">' + md2html(day.digests[j].md) + '</div>';
      }
    } else {
      h += '<div class="panel empty">這天還沒有簡報（簡報在美股收盤後由排程產生，內容會自動出現在這裡）。</div>';
    }

    if (day.alerts) h += '<h2>警報紀錄</h2><div class="panel md">' + md2html(day.alerts) + '</div>';

    var items = day.news || [];
    var tickers = [];
    var seenTk = {};
    items.forEach(function (it) {
      (it.tk || []).forEach(function (t) { if (!seenTk[t]) { seenTk[t] = 1; tickers.push(t); } });
    });
    tickers.sort();
    var macroCount = items.filter(function (it) { return !(it.tk && it.tk.length); }).length;

    h += '<h2>當日新聞（' + items.length + '）</h2>';
    h += '<div class="daytabs">';
    h += '<button type="button" class="daytab on" data-f="all">全部</button>';
    h += '<button type="button" class="daytab" data-f="macro">宏觀' + (macroCount ? '<span class="tn">' + macroCount + '</span>' : '') + '</button>';
    tickers.forEach(function (t) {
      h += '<button type="button" class="daytab" data-f="' + esc(t) + '">' + esc(t) + '</button>';
    });
    h += '</div>';
    h += '<div class="sortbar">' +
      '<span class="sortlabel">排序</span>' +
      '<button type="button" class="sortbtn on" data-sort="score">按評分</button>' +
      '<button type="button" class="sortbtn" data-sort="time">按時間</button>' +
      '</div>';
    h += '<div id="daynews">' + newsList(items) + '</div>';
    return h;
  }

  function viewCat(segs) {
    var p = segs.join('/');
    var node = findNode(DATA.tree, p);
    var stocks = DATA.stocks.filter(function (s) {
      var sp = s.path.join('/');
      return sp === p || sp.indexOf(p + '/') === 0;
    });
    var news = [];
    for (var i = 0; i < DATA.days.length; i++) {
      var day = DATA.days[i];
      for (var j = 0; j < (day.news || []).length; j++) {
        var it = day.news[j];
        var hit = (it.c || []).some(function (c) { return c === p || c.indexOf(p + '/') === 0; });
        if (hit) news.push(it);
      }
    }
    news.sort(function (a, b) { return String(b.p || '').localeCompare(String(a.p || '')); });

    var h = breadcrumb(segs) + '<h1>' + esc(segs[segs.length - 1]) + '</h1>';
    var totalStocks = node ? (node.sc || 0) : stocks.length;
    var totalNews = node ? (node.cnt || 0) : news.length;
    h += '<div class="stats">' + totalStocks + ' 檔股票 · ' + totalNews + ' 條相關新聞</div>';

    if (node && node.c && node.c.length) {
      h += '<div class="panel"><div class="meta">子分類　' + node.c.map(function (k) {
        var u = '#/c/' + k.p.split('/').map(encodeURIComponent).join('/');
        return '<a class="chip" href="' + u + '">' + esc(k.n) + '（' + (k.sc || 0) + ' 檔／' + (k.cnt || 0) + ' 新聞）</a>';
      }).join('') + '</div></div>';
    }

    if (stocks.length) {
      h += '<h2>推薦名單</h2><div class="cards">' + stocks.map(function (s) {
        var q = s.quote || {};
        return '<a class="card" href="#/s/' + encodeURIComponent(s.ticker) + '" style="color:inherit">' +
          '<div><span class="tk">' + esc(s.ticker) + '</span> <span class="nm">' + esc(s.name) + '</span></div>' +
          '<div class="px">' + (q.price != null ? q.price : '—') + ' ' + pct(q.chg1d) + '</div>' +
          '<div class="th">' + esc(s.thesis || '') + '</div></a>';
      }).join('') + '</div>';
    }

    // 股票庫中屬於這個分類的股票
    var nodeHit = findNode(DATA.tree, p);
    var wlTickers = {};
    stocks.forEach(function (s) { wlTickers[s.ticker] = 1; });
    var uniMap = {};
    (DATA.universe || []).forEach(function (u) { uniMap[u.s] = u; });
    var pool = [];
    if (nodeHit) {
      var collect = function (nd) {
        (nd.st || []).forEach(function (t) { if (!wlTickers[t] && uniMap[t]) pool.push(uniMap[t]); });
        (nd.c || []).forEach(collect);
      };
      collect(nodeHit);
    }
    // 去重
    var seenU = {};
    pool = pool.filter(function (u) { if (seenU[u.s]) return false; seenU[u.s] = 1; return true; });
    pool.sort(function (a, b) { return (b.cap || 0) - (a.cap || 0); });

    if (pool.length) {
      h += '<h2>股票庫（' + pool.length + ' 檔）</h2><div class="ugrid">' + pool.slice(0, 120).map(function (u) {
        return '<a class="ucard" href="#/s/' + encodeURIComponent(u.s) + '">' +
          '<span class="utk">' + esc(u.s) + '</span>' +
          '<span class="unm">' + esc(u.n) + '</span>' +
          '<span class="utier ' + (u.tier || 'na') + '">' + (TIER_LABEL[u.tier] || u.tier) + '</span>' +
          '</a>';
      }).join('') + '</div>';
      if (pool.length > 120) h += '<div class="muted">只顯示前 120 檔（按市值）；完整清單請到「股票庫」搜尋。</div>';
    }

    h += '<h2>相關新聞</h2>' + newsList(news, 120);
    return h;
  }

  function relatedTermIds(s) {
    var text = [s.thesis || '', s.invalidation || '', (s.catalysts || []).join(' ')].join(' ');
    var ids = [];
    var seen = {};
    if (TERM_RE) {
      TERM_RE.lastIndex = 0;
      var m;
      while ((m = TERM_RE.exec(text))) {
        var k = termKey(m[1]);
        if (k && !seen[k]) { seen[k] = 1; ids.push(k); }
      }
    }
    return ids.slice(0, 12);
  }

  function viewStock(ticker) {
    var s = null;
    for (var i = 0; i < DATA.stocks.length; i++) if (DATA.stocks[i].ticker === ticker) s = DATA.stocks[i];
    var u = null;
    var uni = DATA.universe || [];
    for (var k = 0; k < uni.length; k++) if (uni[k].s === ticker) u = uni[k];
    if (!s && !u) return empty('找不到 ' + ticker + '：它不在推薦名單，也不在股票庫。');

    var name = s ? s.name : u.n;
    var q = s ? (s.quote || {}) : { price: u.px, chg1d: null };
    var prof = (DATA.profiles || {})[ticker] || null;

    var news = [];
    for (var d = 0; d < DATA.days.length; d++) {
      var day = DATA.days[d];
      for (var j = 0; j < (day.news || []).length; j++) {
        if ((day.news[j].tk || []).indexOf(ticker) >= 0) news.push({ it: day.news[j], date: day.d });
      }
    }
    news.sort(function (a, b) { return String(b.it.p || '').localeCompare(String(a.it.p || '')); });

    var h = breadcrumb(s ? (s.path || ['名單']) : ['股票庫']) +
      '<h1>' + esc(ticker) + ' <span class="badge">' + esc(name) + '</span></h1>';
    var LIST_LABEL = { fundamental: '基本面名單', news: '消息面名單', trend: '趨勢名單' };
    h += '<div class="stats">' +
      (s ? (LIST_LABEL[s.list || 'fundamental'] || '') + ' · ' + (s.bucket === 'core' ? '核心' : '衛星') + ' · 信心 ' + (s.conviction || '—') + '/5' : '') +
      (u ? (s ? ' · ' : '') + esc(u.sec || '') + (u.ind ? ' · ' + esc(u.ind) : '') : '') +
      (s ? '' : ' · 不在推薦名單') + '</div>';

    h += '<div class="panel"><div class="meta" style="font-size:14px">現價 ' +
      (q.price != null ? q.price : '—') + ' ' + pct(q.chg1d) + (s ? '　5 日 ' + pct(q.chg5d) : '') + '</div></div>';

    var story = ((DATA.stories || {})[ticker]) || null;
    var bg = (s && s.background) || (story && story.bg) || (prof && prof.b) || '';
    var rc = (s && s.recent) || (story && story.rc) || '';
    if (!rc && u) {
      var bits = [];
      if (u.y1 != null) bits.push('過去一年' + (u.y1 >= 0 ? '上升 ' : '下跌 ') + Math.abs(u.y1 * 100).toFixed(0) + '%');
      if (u.tier) bits.push('風險評級：' + (TIER_LABEL[u.tier] || u.tier));
      rc = bits.length ? '近期沒有單一重大事件，' + bits.join('，') + '。詳細消息見下方「歷史消息」。' : '';
    }
    if (bg || rc) {
      h += '<h2>公司故事</h2><div class="story">';
      if (bg) h += '<div class="story-block"><div class="story-label">它做什麼、靠什麼賺錢</div><p>' + esc(bg) + '</p></div>';
      if (rc) h += '<div class="story-block"><div class="story-label">最近怎麼了</div><p>' + esc(rc) + '</p></div>';
      h += '</div>';
    }

    if (u) {
      h += '<h2>風險</h2><div class="panel"><div class="meta" style="font-size:14px">' +
        '<span class="utier ' + (u.tier || 'na') + '" style="padding:2px 10px">' + (TIER_LABEL[u.tier] || u.tier) + '</span>' +
        '</div><p class="riskwhy">' + esc(u.rr || '') + '</p>' +
        '<p class="ufoot">風險等級依盈利、現金流、負債、波動、流動性與估值計算；不代表公司好壞，也不是買賣建議。</p></div>';
    }

    if (s && s.charts) {
      h += '<h2>走勢</h2>';
      h += candleChart(s, 'd1', '1 天 · 5 分');
      h += candleChart(s, 'd5', '5 天 · 30 分');
      h += candleChart(s, 'm1', '1 個月 · 日線');
      h += candleChart(s, 'y1', '1 年 · 日線');
      h += candleChart(s, 'y5', '5 年 · 週線');
    }

    if (s) {
      h += '<h2>投資論點</h2>' +
        '<div class="panel">' + linkTerms(esc(s.thesis || '')) + '</div>' +
        (s.thesisPlain ? explain(s.thesisPlain) : '');
      h += '<h2>失效條件</h2>' +
        '<div class="panel">' + linkTerms(esc(s.invalidation || '')) + '</div>' +
        (s.invalidationPlain ? explain(s.invalidationPlain) : '');
      if (s.catalysts && s.catalysts.length) {
        h += '<h2>催化劑</h2>' +
          '<div class="panel"><ul>' + s.catalysts.map(function (c) { return '<li>' + linkTerms(esc(c)) + '</li>'; }).join('') + '</ul></div>' +
          (s.catalystsPlain ? explain(s.catalystsPlain) : '');
      }
    }

    if (u) {
      var rows = [
        ['市值', 'market-cap', capText(u.cap)],
        ['股價', null, u.px == null ? '—' : '\\u0024' + u.px.toFixed(2)],
        ['Beta', 'beta', u.beta == null ? '—' : u.beta.toFixed(2)],
        ['本益比', 'pe', u.pe == null ? '—' : u.pe.toFixed(1)],
        ['淨利率', 'net-margin', u.pm == null ? '—' : (u.pm * 100).toFixed(1) + '%'],
        ['自由現金流', 'fcf', u.fcf == null ? '—' : capText(u.fcf)],
        ['負債／股本', 'debt-equity', u.d2e == null ? '—' : u.d2e.toFixed(2)],
        ['一年漲跌', null, u.y1 == null ? '—' : pct(u.y1 * 100)],
        ['風險分數', 'risk-score', u.score == null ? '資料不足' : u.score + '/100'],
      ];
      h += '<h2>關鍵數據</h2><div class="panel"><div class="uprops">' + rows.map(function (r) {
        return '<div><span>' + termTag(r[0], r[1]) + '</span><b>' + r[2] + '</b></div>';
      }).join('') + '</div><p class="ufoot">虛線名詞可以點，會解說意思。</p></div>';

    }

    if (s) {
      var tagIds = relatedTermIds(s);
      if (tagIds.length) {
        h += '<h2>相關名詞</h2><div class="meta">' + tagIds.map(function (id) {
          return '<button type="button" class="chip term-chip" data-t="' + id + '">' + esc(TERM_MAP[id].term) + '</button>';
        }).join('') + '</div>';
      }
    }

    h += '<h2>所屬 ETF</h2><div id="stock-etfs" class="meta" data-t="' + esc(ticker) + '">載入中…</div>';

    h += '<h2>歷史消息（' + news.length + '）</h2>';
    if (!news.length) {
      h += '<div class="empty">目前留存的新聞裡沒有提到它。</div>';
    } else {
      var byDate = {};
      news.forEach(function (x) { (byDate[x.date] = byDate[x.date] || []).push(x.it); });
      Object.keys(byDate).sort().reverse().forEach(function (date) {
        h += '<h3>' + esc(date) + '　<span class="muted">' + byDate[date].length + ' 條</span></h3>';
        h += newsList(byDate[date], 60);
      });
    }

    return h;
  }

  var CHART_W = 1000, CHART_H = 240;

  function barLabel(ts, mode) {
    var opt;
    if (mode === 'year') {
      opt = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' };
    } else if (mode === 'month') {
      opt = { timeZone: 'America/New_York', month: '2-digit', day: '2-digit' };
    } else {
      opt = { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false };
    }
    try { return new Intl.DateTimeFormat('zh-HK', opt).format(new Date(ts)); } catch (e) { return ''; }
  }

  function candleChart(stock, key, title) {
    var bars = (stock.charts && stock.charts[key]) || [];
    if (bars.length < 2) {
      return '<div class="chart"><div class="chart-head"><span class="chart-title">' + esc(title) + '</span></div>' +
        '<div class="chart-empty">沒有圖表資料</div></div>';
    }

    var mode = key === 'y5' ? 'year' : key === 'm1' || key === 'y1' ? 'month' : 'intraday';
    var hi = -Infinity, lo = Infinity;
    for (var i = 0; i < bars.length; i++) {
      if (bars[i].h > hi) hi = bars[i].h;
      if (bars[i].l < lo) lo = bars[i].l;
    }
    var span = (hi - lo) || 1;
    var top = 12, bottom = CHART_H - 26;
    var y = function (v) { return top + (hi - v) / span * (bottom - top); };
    var bw = CHART_W / bars.length;
    var bodyW = Math.max(1.2, Math.min(9, bw * 0.62));

    var cells = [];
    for (var j = 0; j < bars.length; j++) {
      var b = bars[j];
      var cx = j * bw + bw / 2;
      var col = b.c >= b.o ? '#3fb950' : '#f85149';
      var yO = y(b.o), yC = y(b.c);
      var rTop = Math.min(yO, yC), rBot = Math.max(yO, yC);
      cells.push('<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="' + y(b.h).toFixed(1) + '" y2="' + y(b.l).toFixed(1) + '" stroke="' + col + '" stroke-width="' + Math.max(0.8, bodyW * 0.2).toFixed(2) + '"/>');
      cells.push('<rect x="' + (cx - bodyW / 2).toFixed(1) + '" y="' + rTop.toFixed(1) + '" width="' + bodyW.toFixed(1) + '" height="' + Math.max(1, rBot - rTop).toFixed(1) + '" fill="' + col + '"/>');
    }

    var grid = '';
    for (var g = 1; g <= 3; g++) {
      var gy = (top + (bottom - top) * g / 4).toFixed(1);
      grid += '<line x1="0" x2="' + CHART_W + '" y1="' + gy + '" y2="' + gy + '" stroke="#232b36" stroke-width="1" stroke-dasharray="4 7"/>';
    }

    var first = bars[0].c, last = bars[bars.length - 1].c;
    var chg = (last / first - 1) * 100;
    var payload = JSON.stringify({ bars: bars, mode: mode });

    return '<div class="chart" data-chart="' + esc(payload) + '">' +
      '<div class="chart-head">' +
        '<span class="chart-title">' + esc(title) + '</span>' +
        '<span class="chart-chg ' + (chg >= 0 ? 'up' : 'down') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</span>' +
        '<span class="chart-range">' + lo.toFixed(2) + ' – ' + hi.toFixed(2) + '</span>' +
      '</div>' +
      '<div class="chart-box">' +
        '<svg viewBox="0 0 ' + CHART_W + ' ' + CHART_H + '" preserveAspectRatio="none" aria-hidden="true">' + grid + cells.join('') + '</svg>' +
        '<div class="chart-x"><span>' + barLabel(bars[0].t, mode) + '</span><span>' + barLabel(bars[bars.length - 1].t, mode) + '</span></div>' +
        '<div class="chart-cursor" hidden></div>' +
        '<div class="chart-tip" hidden></div>' +
      '</div></div>';
  }

  function bindCharts(root) {
    var nodes = root.querySelectorAll('.chart[data-chart]');
    for (var i = 0; i < nodes.length; i++) bindChart(nodes[i]);
  }

  function bindChart(el) {
    var data;
    try { data = JSON.parse(el.getAttribute('data-chart')); } catch (e) { return; }
    var bars = data.bars || [];
    if (bars.length < 2) return;
    var box = el.querySelector('.chart-box');
    var tip = el.querySelector('.chart-tip');
    var cursor = el.querySelector('.chart-cursor');
    if (!box || !tip) return;

    function onMove(ev) {
      var r = box.getBoundingClientRect();
      if (!r.width) return;
      var ratio = (ev.clientX - r.left) / r.width;
      var idx = Math.max(0, Math.min(bars.length - 1, Math.floor(ratio * bars.length)));
      var b = bars[idx];
      tip.hidden = false;
      tip.innerHTML = '<b>' + barLabel(b.t, data.mode) + '</b>' +
        '<span>開 ' + b.o + '　高 ' + b.h + '</span>' +
        '<span>低 ' + b.l + '　收 ' + b.c + '</span>';
      tip.style.left = Math.max(4, Math.min(r.width - 120, ratio * r.width - 50)) + 'px';
      if (cursor) {
        cursor.hidden = false;
        cursor.style.left = (ratio * 100).toFixed(2) + '%';
      }
    }

    function onLeave() {
      tip.hidden = true;
      if (cursor) cursor.hidden = true;
    }

    box.addEventListener('mousemove', onMove);
    box.addEventListener('mouseleave', onLeave);
  }

  function viewSearch(q) {
    var term = q.toLowerCase();
    var stocks = DATA.stocks.filter(function (s) {
      return (s.ticker + ' ' + s.name + ' ' + (s.thesis || '')).toLowerCase().indexOf(term) >= 0;
    });
    var news = [];
    for (var i = 0; i < DATA.days.length; i++) {
      for (var j = 0; j < (DATA.days[i].news || []).length; j++) {
        var it = DATA.days[i].news[j];
        if ((it.t + ' ' + (it.tk || []).join(' ')).toLowerCase().indexOf(term) >= 0) news.push(it);
      }
    }
    news.sort(function (a, b) { return String(b.p || '').localeCompare(String(a.p || '')); });

    var h = '<h1>搜尋：' + esc(q) + '</h1>';
    h += '<div class="stats">' + stocks.length + ' 檔股票 · ' + news.length + ' 條新聞</div>';
    if (stocks.length) h += '<h2>股票</h2><div class="meta">' + stocks.map(function (s) { return chip(s.ticker); }).join('') + '</div>';
    h += '<h2>新聞</h2>' + newsList(news, 100);
    return h;
  }

  // ── 路由 ──────────────────────────────────────────────────────────────
  function glossaryList(needle) {
    var arr = (GLOSSARY || []);
    if (needle) {
      arr = arr.filter(function (g) {
        return ((g.term || '') + ' ' + (g.aliases || []).join(' ')).toLowerCase().indexOf(needle) >= 0;
      });
    }
    if (!arr.length) return '<div class="muted">沒有符合的詞。</div>';
    return '<div class="gcards">' + arr.map(function (g) {
      return '<div class="gcard">' +
        '<div class="tt-cat">' + esc(g.cat || '') + '</div>' +
        '<h3 class="tt-term">' + esc(g.term) + '</h3>' +
        '<div class="tt-plain"><span class="tt-label">人話</span><p>' + esc(g.plain || '') + '</p></div>' +
        '<div class="tt-pro"><span class="tt-label">專業</span><p>' + esc(g.pro || '') + '</p></div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function candidateBlock() {
    var c = (DATA.termCandidates && DATA.termCandidates.items) || [];
    if (!c.length) return '';
    return '<h2>待審候選（每週自動產生）</h2>' +
      '<div class="muted">這些是從最近新聞挑出來、詞庫還沒收錄的詞。要收哪幾個跟我說，或直接改 glossary.json。</div>' +
      '<div class="gcards" style="margin-top:10px">' + c.map(function (g) {
        return '<div class="gcard cand">' +
          '<div class="tt-cat">' + esc(g.cat || '') + '</div>' +
          '<h3 class="tt-term">' + esc(g.term) + '</h3>' +
          '<div class="tt-plain"><span class="tt-label">人話</span><p>' + esc(g.plain || '') + '</p></div>' +
          '<div class="tt-pro"><span class="tt-label">專業</span><p>' + esc(g.pro || '') + '</p></div>' +
          '</div>';
      }).join('') + '</div>';
  }

  function viewGlossary(needle) {
    var n = (GLOSSARY || []).length;
    var h = '<h1>名詞庫 <span class="badge">' + n + ' 個詞</span></h1>';
    h += '<div class="stats">名單頁的底線詞彙可以直接點' +
      (DATA.meta && DATA.meta.glossary ? '｜詞庫更新：' + DATA.meta.glossary : '') + '</div>';
    h += '<div class="gbartop"><input id="gq" class="inp" placeholder="搜尋詞，例如：估值、財測、回購" value="' + esc(needle || '') + '"></div>';
    h += '<div id="glist">' + glossaryList((needle || '').toLowerCase()) + '</div>';
    h += candidateBlock();
    return h;
  }

  function route() {
    var raw = location.hash.replace(/^#\/?/, '');
    var segs = raw.split('/').filter(Boolean).map(function (x) { return decodeURIComponent(x); });
    var main = $('#main');
    var activeDate = null;
    var activePath = null;

    if (segs[0] === 'd') {
      activeDate = segs[1] || (DATA.days[0] && DATA.days[0].d);
      main.innerHTML = viewDate(activeDate);
    } else if (segs[0] === 'c') {
      activePath = segs.slice(1).join('/');
      main.innerHTML = viewCat(segs.slice(1));
    } else if (segs[0] === 's') {
      main.innerHTML = viewStock(segs[1]);
    } else if (segs[0] === 'u' && segs[1]) {
      main.innerHTML = viewStock(segs[1].toUpperCase());
    } else if (segs[0] === 'w') {
      main.innerHTML = viewWatchlist();
    } else if (segs[0] === 'e') {
      main.innerHTML = viewEtfs();
      ensureEtfs(function () { bindEtfs(); });
    } else if (segs[0] === 'u') {
      main.innerHTML = viewUniverse();
      ensureUniverse(function () {
        var stats = document.querySelector('#ustats');
        if (stats) {
          var d = { low: 0, medium: 0, high: 0, na: 0 };
          (UNI || []).forEach(function (x) { d[x.tier] = (d[x.tier] || 0) + 1; });
          stats.textContent = (UNI || []).length + ' 檔 · 低風險 ' + d.low + ' · 中風險 ' + d.medium + ' · 高風險 ' + d.high + ' · 未評級 ' + d.na;
        }
        var metaEl = document.querySelector('#umeta');
        if (metaEl && DATA.meta) metaEl.textContent = '股票資料更新：' + (DATA.meta.universe || '—') + '｜公司故事：' + (DATA.meta.stories || '—') + '（每週自動更新）';
        var sel = document.querySelector('#usec');
        if (sel) {
          Array.from(new Set((UNI || []).map(function (x) { return x.sec; }).filter(Boolean))).sort().forEach(function (sec) {
            var o = document.createElement('option');
            o.value = sec; o.textContent = sec;
            sel.appendChild(o);
          });
        }
        bindUniverse();
      });
    } else if (segs[0] === 'g') {
      var needle = segs.slice(1).join('/');
      main.innerHTML = viewGlossary(needle);
      var input = main.querySelector('#gq');
      var listEl = main.querySelector('#glist');
      if (input && listEl) {
        input.addEventListener('input', function () {
          listEl.innerHTML = glossaryList(this.value.trim().toLowerCase());
        });
      }
    } else if (segs[0] === 'q') {
      main.innerHTML = viewSearch(segs.slice(1).join('/'));
    } else {
      activeDate = DATA.days[0] && DATA.days[0].d;
      main.innerHTML = viewDate(activeDate);
    }
    renderSide(activeDate, activePath);
    bindCharts(main);
    bindDayTabs();
    bindMode();
    loadStockEtfs();
    main.scrollTop = 0;
  }

  document.addEventListener('click', function (e) {
    var termEl = e.target.closest && e.target.closest('.term, .term-chip');
    if (termEl) {
      openTerm(termEl.getAttribute('data-t'));
      return;
    }
    var closer = e.target.closest && e.target.closest('[data-close]');
    if (closer) {
      closeTerm();
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeTerm();
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('#side .tabs button');
    if (btn) {
      sideTab = btn.getAttribute('data-tab');
      route();
      return;
    }
    // 由連結導航時，分頁跟著內容走（但不再反過來覆寫使用者的選擇）
    var a = e.target.closest && e.target.closest('a');
    if (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('#/d/') === 0) sideTab = 'date';
      else if (href.indexOf('#/c/') === 0) sideTab = 'cat';
    }
  });

  $('#q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && this.value.trim()) {
      location.hash = '#/q/' + encodeURIComponent(this.value.trim());
    }
  });

  var UNI = null;
  var uniState = { q: '', tier: 'all', sec: 'all', sort: 'cap', shown: 150 };

  function ensureUniverse(cb) {
    UNI = DATA.universe || [];
    cb();
  }

  function capText(v) {
    if (v == null) return '—';
    if (v >= 1e12) return '\u0024' + (v / 1e12).toFixed(2) + 'T';
    if (v >= 1e9) return '\u0024' + (v / 1e9).toFixed(0) + 'B';
    return '\u0024' + (v / 1e6).toFixed(0) + 'M';
  }

  var TIER_LABEL = { low: '低', medium: '中', high: '高', na: '未評級' };

  function uniFilter() {
    var q = uniState.q.toLowerCase();
    var out = (UNI || []).filter(function (x) {
      if (uniState.tier !== 'all' && x.tier !== uniState.tier) return false;
      if (uniState.sec !== 'all' && x.sec !== uniState.sec) return false;
      if (q && (x.s + ' ' + x.n).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = uniState.sort;
    out.sort(function (a, b) {
      if (key === 'score') return (b.score || -1) - (a.score || -1);
      if (key === 'beta') return (b.beta || 0) - (a.beta || 0);
      if (key === 'name') return a.s.localeCompare(b.s);
      return (b.cap || 0) - (a.cap || 0);
    });
    return out;
  }

  function uniRow(x) {
    var t = x.tier || 'na';
    return '<div class="urow" data-s="' + esc(x.s) + '">' +
      '<span class="utk">' + esc(x.s) + '</span>' +
      '<span class="unm">' + esc(x.n) + '</span>' +
      '<span class="use">' + esc(x.sec || '') + '</span>' +
      '<span class="ucp">' + capText(x.cap) + '</span>' +
      '<span class="ub">' + (x.beta == null ? '—' : x.beta.toFixed(2)) + '</span>' +
      '<span class="utier ' + t + '">' + (TIER_LABEL[t] || t) + '</span>' +
      '</div>';
  }

  function renderUniList() {
    var listEl = document.querySelector('#ulist');
    if (!listEl) return;
    var all = uniFilter();
    var rows = all.slice(0, uniState.shown).map(uniRow).join('');
    var more = all.length > uniState.shown
      ? '<button type="button" id="umore" class="umore">顯示更多（還有 ' + (all.length - uniState.shown) + ' 檔）</button>'
      : '';
    listEl.innerHTML = '<div class="uhead"><span>代號</span><span>名稱</span><span>產業</span><span>市值</span><span>β</span><span>風險</span></div>' +
      (rows || '<div class="empty">沒有符合條件的股票。</div>') + more;

    var m = document.querySelector('#umore');
    if (m) m.addEventListener('click', function () { uniState.shown += 200; renderUniList(); });

    Array.prototype.forEach.call(listEl.querySelectorAll('.urow'), function (row) {
      row.addEventListener('click', function () { location.hash = '#/s/' + row.getAttribute('data-s'); });
    });
  }

  function openUniCard(sym) {
    var x = (UNI || []).find(function (i) { return i.s === sym; });
    if (!x) return;
    var m = document.getElementById('term-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'term-modal';
      m.className = 'modal';
      m.hidden = true;
      m.innerHTML = '<div class="modal-backdrop" data-close="1"></div>' +
        '<div class="modal-card" role="dialog" aria-modal="true">' +
        '<button type="button" class="modal-close" data-close="1" aria-label="關閉">✕</button>' +
        '<div class="modal-body"></div></div>';
      document.body.appendChild(m);
    }
    var rows = [
      ['市值', capText(x.cap)],
      ['股價', x.px == null ? '—' : '\u0024' + x.px.toFixed(2)],
      ['產業', (x.sec || '') + (x.ind ? ' · ' + x.ind : '')],
      ['Beta', x.beta == null ? '—' : x.beta.toFixed(2)],
      ['本益比', x.pe == null ? '—' : x.pe.toFixed(1)],
      ['淨利率', x.pm == null ? '—' : (x.pm * 100).toFixed(1) + '%'],
      ['自由現金流', x.fcf == null ? '—' : capText(x.fcf)],
      ['負債／股本', x.d2e == null ? '—' : x.d2e.toFixed(2)],
      ['一年漲跌', x.y1 == null ? '—' : (x.y1 > 0 ? '+' : '') + (x.y1 * 100).toFixed(1) + '%'],
      ['風險分數', x.score == null ? '資料不足' : x.score + '/100'],
    ];
    m.querySelector('.modal-body').innerHTML =
      '<div class="tt-cat">' + esc(x.sec || '') + '</div>' +
      '<h3 class="tt-term">' + esc(x.s) + ' · ' + esc(x.n) + '</h3>' +
      '<div class="tt-alias">風險：' + (TIER_LABEL[x.tier] || x.tier) + (x.flags && x.flags.length ? '（' + x.flags.map(esc).join('、') + '）' : '') + '</div>' +
      '<div class="uprops">' + rows.map(function (r) {
        return '<div><span>' + esc(r[0]) + '</span><b>' + esc(String(r[1])) + '</b></div>';
      }).join('') + '</div>' +
      '<p class="ufoot">風險分數只反映可取得的數據（盈利、現金流、負債、波動、流動性、估值），未涵蓋商業模式判斷。資料不足時標示「未評級」。</p>';
    m.hidden = false;
  }

  function bindUniverse() {
    var q = document.querySelector('#uq');
    var sec = document.querySelector('#usec');
    var sort = document.querySelector('#usort');
    var chips = document.querySelectorAll('.uchip');

    if (q) q.addEventListener('input', function () { uniState.q = this.value.trim(); uniState.shown = 150; renderUniList(); });
    if (sec) sec.addEventListener('change', function () { uniState.sec = this.value; uniState.shown = 150; renderUniList(); });
    if (sort) sort.addEventListener('change', function () { uniState.sort = this.value; renderUniList(); });
    Array.prototype.forEach.call(chips, function (c) {
      c.addEventListener('click', function () {
        uniState.tier = c.getAttribute('data-tier');
        uniState.shown = 150;
        Array.prototype.forEach.call(chips, function (o) { o.classList.toggle('on', o === c); });
        renderUniList();
      });
    });
    renderUniList();
  }

  var ETF = null;
  var etfState = { q: '', sort: 'aum', shown: 200 };

  function ensureEtfs(cb) {
    ETF = DATA.etfs || [];
    cb();
  }

  function etfFilter() {
    var q = etfState.q.toLowerCase();
    var out = (ETF || []).filter(function (e) {
      return !q || (e.s + ' ' + e.n).toLowerCase().indexOf(q) >= 0;
    });
    out.sort(function (a, b) { return (b.aum || 0) - (a.aum || 0); });
    return out;
  }

  function renderEtfList() {
    var el = document.querySelector('#elist');
    if (!el) return;
    var all = etfFilter();
    var rows = all.slice(0, etfState.shown).map(function (e) {
      return '<div class="urow erow" data-e="' + esc(e.s) + '">' +
        '<span class="utk">' + esc(e.s) + '</span>' +
        '<span class="unm">' + esc(e.n) + '</span>' +
        '<span class="ucp">' + capText(e.aum) + '</span>' +
        '<span class="ub">' + (e.h || []).length + ' 檔</span>' +
        '</div>';
    }).join('');
    el.innerHTML = '<div class="uhead ehead"><span>代號</span><span>名稱</span><span>AUM</span><span>持倉</span></div>' +
      (rows || '<div class="empty">沒有符合條件的 ETF。</div>');
    Array.prototype.forEach.call(el.querySelectorAll('.erow'), function (row) {
      row.addEventListener('click', function () { openEtfCard(row.getAttribute('data-e')); });
    });
  }

  function openEtfCard(sym) {
    if (!ETF) return;
    var e = ETF.find(function (x) { return x.s === sym; });
    if (!e) return;
    renderEtfCard(e);
  }

  function renderEtfCard(e) {
    var m = document.getElementById('term-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'term-modal';
      m.className = 'modal';
      m.hidden = true;
      m.innerHTML = '<div class="modal-backdrop" data-close="1"></div>' +
        '<div class="modal-card" role="dialog" aria-modal="true">' +
        '<button type="button" class="modal-close" data-close="1" aria-label="關閉">✕</button>' +
        '<div class="modal-body"></div></div>';
      document.body.appendChild(m);
    }
    var list = (e.h || []).map(function (h) {
      var stock = (window.__UNIVERSE__ || []).find(function (x) { return x.s === h.t; });
      var w = h.w == null ? '' : ' ' + (h.w * 100).toFixed(1) + '%';
      return '<div class="holdrow" data-s="' + esc(h.t) + '"><b>' + esc(h.t) + '</b>' +
        '<span>' + esc(stock ? stock.n : '') + '</span>' +
        '<em>' + w + '</em></div>';
    }).join('');

    m.querySelector('.modal-body').innerHTML =
      '<div class="tt-cat">ETF · 資產規模 ' + capText(e.aum) + '</div>' +
      '<h3 class="tt-term">' + esc(e.s) + '</h3>' +
      '<div class="tt-alias">' + esc(e.n) + '</div>' +
      '<div class="tt-plain"><span class="tt-label">前十大持倉</span>' + (list || '<p>沒有資料</p>') + '</div>' +
      '<p class="ufoot">ETF 持倉只取 Yahoo 的前十大（佔 ETF 一部分權重），所以這裡只會列出「在股票庫內」且屬前十大持倉的股票。</p>';
    m.hidden = false;

    Array.prototype.forEach.call(m.querySelectorAll('.holdrow'), function (row) {
      row.addEventListener('click', function () {
        location.hash = '#/s/' + row.getAttribute('data-s');
      });
    });
  }

  function viewEtfs() {
    return '<h1>ETF 庫 <span class="badge">AUM ≥ 10 億美元</span></h1>' +
      '<div class="stats" id="estats">載入中…</div>' +
      '<div class="panel ufilters">' +
        '<input id="eq" class="gsearch" type="search" placeholder="搜尋 ETF 代號或名稱…" autocomplete="off">' +
      '</div>' +
      '<div id="elist"></div>';
  }

  function bindEtfs() {
    var q = document.querySelector('#eq');
    if (q) q.addEventListener('input', function () { etfState.q = this.value.trim(); etfState.shown = 200; renderEtfList(); });
    var st = document.querySelector('#estats');
    if (st) st.textContent = (ETF || []).length + ' 檔 · 合計 ' + capText((ETF || []).reduce(function (a, x) { return a + (x.aum || 0); }, 0));
    renderEtfList();
  }

  function loadStockEtfs() {
    var el = document.querySelector('#stock-etfs');
    if (!el) return;
    var tk = el.getAttribute('data-t');
    ensureEtfs(function () {
      var hits = (ETF || []).filter(function (e) {
        return (e.h || []).some(function (x) { return x.t === tk; });
      });
      if (!hits.length) {
        el.innerHTML = '<span class="muted">前十大持倉中沒有 ETF 持有它。</span>';
        return;
      }
      el.innerHTML = hits.slice(0, 24).map(function (e) {
        return '<button type="button" class="chip etfchip" data-etf="' + esc(e.s) + '">' + esc(e.s) + ' · ' + capText(e.aum) + '</button>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('.etfchip'), function (btn) {
        btn.addEventListener('click', function () { openEtfCard(btn.getAttribute('data-etf')); });
      });
    });
  }

  function termTag(label, id) {
    return id ? '<button type="button" class="term" data-t="' + id + '">' + esc(label) + '</button>' : esc(label);
  }

  function renderStockDetail(x) {
    var p = (DATA.profiles || {})[x.s] || {};
    var inList = (DATA.stocks || []).some(function (s) { return s.ticker === x.s; });
    var tier = TIER_LABEL[x.tier] || x.tier;

    var rows = [
      ['市值', 'market-cap', capText(x.cap)],
      ['股價', null, x.px == null ? '—' : '\\u0024' + x.px.toFixed(2)],
      ['Beta', 'beta', x.beta == null ? '—' : x.beta.toFixed(2)],
      ['本益比', 'pe', x.pe == null ? '—' : x.pe.toFixed(1)],
      ['淨利率', 'net-margin', x.pm == null ? '—' : (x.pm * 100).toFixed(1) + '%'],
      ['自由現金流', 'fcf', x.fcf == null ? '—' : capText(x.fcf)],
      ['負債／股本', 'debt-equity', x.d2e == null ? '—' : x.d2e.toFixed(2)],
      ['一年漲跌', null, x.y1 == null ? '—' : pct(x.y1 * 100)],
      ['風險分數', 'risk-score', x.score == null ? '資料不足' : x.score + '/100'],
    ];

    var h = '<div class="crumb"><a href="#/u">股票庫</a> › ' + esc(x.s) + '</div>';
    h += '<h1>' + esc(x.s) + ' <span class="badge">' + esc(x.n) + '</span></h1>';
    h += '<div class="stats">' + esc(x.sec || '') + (x.ind ? ' · ' + esc(x.ind) : '') +
      (inList ? ' · <a href="#/s/' + encodeURIComponent(x.s) + '">在推薦名單</a>' : ' · 不在名單') + '</div>';

    h += '<h2>公司背景</h2><div class="story">';
    h += '<div class="story-block"><div class="story-label">基本資料</div><p>' + esc(p.b || '（沒有資料）') + '</p></div>';
    if (p.s) {
      h += '<div class="story-block"><div class="story-label">公司自述（英文原文）</div><p style="font-size:13px;line-height:1.8">' + esc(p.s) + '</p></div>';
    }
    h += '</div>';

    h += '<h2>關鍵數據</h2><div class="panel"><div class="uprops">' + rows.map(function (r) {
      return '<div><span>' + termTag(r[0], r[1]) + '</span><b>' + r[2] + '</b></div>';
    }).join('') + '</div>' +
      '<p class="ufoot">上面的虛線名詞可以點，會解說它的意思。</p></div>';

    h += '<h2>風險</h2><div class="panel"><div class="meta" style="font-size:14px">' +
      '<span class="utier ' + (x.tier || 'na') + '" style="padding:2px 10px">' + tier + '</span>' +
      (x.flags && x.flags.length ? '　' + x.flags.map(esc).join('、') : '') + '</div>' +
      '<p class="ufoot">風險分數依盈利、現金流、負債、波動、流動性與估值計算，不代表公司好壞。</p></div>';

    return h;
  }

  function viewWatchlist() {
    var meta = DATA.watchlists || {};
    var groups = [
      { key: 'fundamental', label: '基本面名單', horizon: '20 個交易日', note: '經營或盈利改善，且估值仍有支持' },
      { key: 'news', label: '消息面名單', horizon: '1–5 個交易日', note: '已核實、有實質影響、價格可能未反映' },
      { key: 'trend', label: '趨勢名單', horizon: '1–5 個交易日', note: '價格、成交量與相對強弱支持延續' },
    ];

    var h = '<h1>推薦名單 <span class="badge">' + DATA.stocks.length + ' 檔</span></h1>';
    h += '<div class="stats">三份名單各 20 檔、合計 60 檔不重複；只分析個股，不含 ETF。每日覆核，改動記錄在 watchlist-history.jsonl。</div>';

    groups.forEach(function (g) {
      var arr = DATA.stocks.filter(function (s) { return (s.list || 'fundamental') === g.key; });
      if (!arr.length) return;
      h += '<h2>' + g.label + '（' + arr.length + '）</h2>';
      h += '<div class="muted">' + g.note + '｜預測期限：' + g.horizon + '</div>';
      h += '<div class="gcards" style="margin-top:10px">' + arr.map(function (s) {
        var q = s.quote || {};
        return '<a class="gcard" href="#/s/' + encodeURIComponent(s.ticker) + '" style="color:inherit;text-decoration:none">' +
          '<div class="tt-cat">' + (s.bucket === 'core' ? '核心' : '衛星') + ' · 信心 ' + (s.conviction || '—') + '/5</div>' +
          '<h3 class="tt-term">' + esc(s.ticker) + '</h3>' +
          '<div class="tt-alias">' + esc(s.name) + '</div>' +
          '<div class="px" style="margin-top:6px">' + (q.price != null ? q.price : '—') + ' ' + pct(q.chg1d) + '</div>' +
          '<p class="tt-plain" style="margin-top:6px"><span class="tt-label">人話</span><span style="font-size:12px;color:var(--muted)">' +
          esc((s.thesisPlain || s.thesis || '').slice(0, 70)) + '…</span></p></a>';
      }).join('') + '</div>';
    });
    return h;
  }

  function viewUniverse() {
    return '<h1>股票庫 <span class="badge">市值 ≥ 20 億美元</span></h1>' +
      '<div class="stats" id="ustats">載入中…</div>' +
      '<div class="muted" id="umeta"></div>' +
      '<div class="panel ufilters">' +
        '<input id="uq" class="gsearch" type="search" placeholder="搜尋代號或公司名…" autocomplete="off">' +
        '<div class="uchips">' +
          '<button type="button" class="uchip on" data-tier="all">全部</button>' +
          '<button type="button" class="uchip" data-tier="low">低風險</button>' +
          '<button type="button" class="uchip" data-tier="medium">中風險</button>' +
          '<button type="button" class="uchip" data-tier="high">高風險</button>' +
          '<button type="button" class="uchip" data-tier="na">未評級</button>' +
        '</div>' +
        '<div class="uselrow">' +
          '<select id="usec" class="usel"><option value="all">所有產業</option></select>' +
          '<select id="usort" class="usel">' +
            '<option value="cap">市值（大→小）</option>' +
            '<option value="score">風險分數（高→低）</option>' +
            '<option value="beta">Beta（高→低）</option>' +
            '<option value="name">代號（A→Z）</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div id="ulist"></div>';
  }

  window.addEventListener('hashchange', route);
  if (location.hash.indexOf('#/d/') === 0) sideTab = 'date';
  route();

  if (DATA.generatedAt) {
    $('#stamp').textContent = '更新 ' + new Date(DATA.generatedAt).toLocaleString('zh-HK', { timeZone: HKT, hour12: false });
  }
})();
