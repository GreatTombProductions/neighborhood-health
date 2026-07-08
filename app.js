(function() {
    'use strict';

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);
    const BASE = 'data/';
    const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';

    let meta = null;
    const searchCache = {};
    const detailCache = {};
    const proximityCache = {};
    let currentView = 'intro';
    let allCounties = [];

    // ── Init ──
    async function init() {
        try {
            const resp = await fetch(BASE + 'meta.json');
            meta = await resp.json();
            renderIntro();
            populateStates();
            // Preload county index for proximity search
            loadCountyIndex();
        } catch (e) {
            console.error(e);
        }

        // Tab switching
        $$('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.tab').forEach(t => t.classList.remove('active'));
                $$('.search-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const panel = tab.dataset.tab;
                $(`#${panel}-search`).classList.add('active');
                showIntro();
            });
        });

        // County name search
        let debounce;
        $('#search-input').addEventListener('input', e => {
            clearTimeout(debounce);
            debounce = setTimeout(() => searchCounty(e.target.value.trim()), 200);
        });

        // State select
        $('#state-select').addEventListener('change', e => {
            if (e.target.value) {
                loadState(e.target.value);
            } else {
                showIntro();
            }
        });

        // Nearby search
        $('#nearby-btn').addEventListener('click', searchNearby);
        $('#addr-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') searchNearby();
        });

        // Back button
        $('#back-btn').addEventListener('click', () => {
            $('#detail').classList.add('hidden');
            $('#results').classList.remove('hidden');
            currentView = 'results';
            window.scrollTo(0, 0);
        });
    }

    // ── Load county index ──
    async function loadCountyIndex() {
        try {
            const resp = await fetch(BASE + 'counties.json');
            allCounties = await resp.json();
        } catch (e) { /* non-critical */ }
    }

    // ── Render intro stats ──
    function renderIntro() {
        if (!meta) return;
        $('#stat-counties').textContent = fmt(meta.total_counties);
        $('#stat-states').textContent = fmt(meta.total_states);
        $('#stat-measures').textContent = meta.num_measures || '40';
    }

    function showIntro() {
        $('#intro').classList.remove('hidden');
        $('#results').innerHTML = '';
        $('#state-results').innerHTML = '';
        $('#nearby-results').innerHTML = '';
        $('#detail').classList.add('hidden');
        currentView = 'intro';
    }

    // ── County name search ──
    async function searchCounty(query) {
        if (!query || query.length < 1) {
            $('#results').innerHTML = '';
            showIntro();
            return;
        }

        const first = query[0].toUpperCase();
        if (!/[A-Z]/.test(first)) return;

        $('#search-status').textContent = 'Searching…';
        $('#intro').classList.add('hidden');

        let counties;
        const cacheKey = first.toLowerCase();
        if (searchCache[cacheKey]) {
            counties = searchCache[cacheKey];
        } else {
            try {
                const resp = await fetch(`${BASE}search/${cacheKey}.json`);
                if (!resp.ok) { $('#results').innerHTML = '<p>No results.</p>'; $('#search-status').textContent = ''; return; }
                const data = await resp.json();
                counties = data.counties || [];
                searchCache[cacheKey] = counties;
            } catch (e) {
                $('#results').innerHTML = '<p>Error loading data.</p>';
                return;
            }
        }

        const q = query.toLowerCase();
        const matches = counties.filter(c => c.name.toLowerCase().includes(q));

        if (matches.length === 0) {
            $('#results').innerHTML = '<p>No counties match that name.</p>';
        } else {
            $('#results').innerHTML = matches.slice(0, 50).map(c => renderCountyCard(c)).join('');
            bindCardClicks();
        }
        $('#search-status').textContent = matches.length > 50
            ? `Found ${matches.length} counties (showing first 50)`
            : `Found ${matches.length} ${matches.length === 1 ? 'county' : 'counties'}`;
    }

    function renderCountyCard(c) {
        let standout = '';
        if (c.standout && c.standout.length > 0) {
            standout = '<div class="standout">' + c.standout.map(s => {
                const cls = s.pct_diff > 0
                    ? (s.id === 'ACCESS2' || s.id.includes('SCREEN') || s.id === 'CHECKUP' || s.id === 'DENTAL' || s.id === 'MAMMOUSE' || s.id === 'BPMED' || s.id === 'CHOLSCREEN'
                        ? 'worse' : 'worse')
                    : (s.id === 'ACCESS2' || s.id.includes('SCREEN') || s.id === 'CHECKUP' || s.id === 'DENTAL' || s.id === 'MAMMOUSE' || s.id === 'BPMED' || s.id === 'CHOLSCREEN'
                        ? 'better' : 'better');
                // "better" = lower prevalence for most measures, higher for screenings
                const measureDef = meta.measures[s.id];
                const betterDir = measureDef ? measureDef.better : 'lower';
                const isGood = (betterDir === 'lower' && s.pct_diff < 0) || (betterDir === 'higher' && s.pct_diff > 0);
                const actualCls = isGood ? 'better' : 'worse';
                const arrow = s.pct_diff > 0 ? '↑' : '↓';
                return `<span class="badge ${actualCls}">${s.label}: ${s.value}% ${arrow}${Math.abs(s.pct_diff)}% vs US</span>`;
            }).join('') + '</div>';
        }

        return `<div class="result-card" data-fips="${c.fips}">
            <h3>${c.name}</h3>
            <div class="meta">${c.state} &middot; Population ${fmt(c.pop)}</div>
            ${standout}
        </div>`;
    }

    function bindCardClicks() {
        $$('.result-card').forEach(card => {
            card.addEventListener('click', () => {
                const fips = card.dataset.fips;
                loadDetail(fips);
            });
        });
    }

    // ── State browse ──
    function populateStates() {
        const sel = $('#state-select');
        if (!meta) return;
        // Get states from state files
        const seen = new Set();
        const stateFiles = meta.index_letters || [];
        // Actually, use counties.json for state listing
        fetch(BASE + 'counties.json').then(r => r.json()).then(counties => {
            const states = [...new Set(counties.map(c => c.state))].sort();
            states.forEach(st => {
                const opt = document.createElement('option');
                opt.value = st.toLowerCase();
                opt.textContent = st;
                sel.appendChild(opt);
            });
        });
    }

    async function loadState(stateCode) {
        $('#intro').classList.add('hidden');
        $('#state-results').innerHTML = '<p>Loading…</p>';

        try {
            const resp = await fetch(`${BASE}states/${stateCode}.json`);
            if (!resp.ok) { $('#state-results').innerHTML = '<p>No data for that state.</p>'; return; }
            const data = await resp.json();
            renderStateTable(data);
        } catch (e) {
            $('#state-results').innerHTML = '<p>Error loading state data.</p>';
        }
    }

    function renderStateTable(data) {
        const counties = data.counties || [];
        let html = `<h3 style="margin-bottom:0.5rem">${data.state_name} — ${counties.length} counties</h3>`;
        html += '<table class="state-table"><thead><tr>';
        html += '<th>County</th><th>Population</th>';
        // Show a few key indicator columns
        const indicators = [
            {id: 'PHLTH', label: 'Fair/Poor Health'},
            {id: 'OBESITY', label: 'Obesity'},
            {id: 'DIABETES', label: 'Diabetes'},
            {id: 'CSMOKING', label: 'Smoking'},
            {id: 'ACCESS2', label: 'Uninsured'},
        ];
        indicators.forEach(ind => {
            html += `<th>${ind.label}</th>`;
        });
        html += '</tr></thead><tbody>';

        counties.forEach(c => {
            html += `<tr data-fips="${c.fips}">`;
            html += `<td class="county-name">${c.name}</td>`;
            html += `<td>${fmt(c.pop)}</td>`;
            indicators.forEach(ind => {
                const km = c.key_measures && c.key_measures[ind.id];
                if (km) {
                    // Compare to national median
                    const med = km.median || 0;
                    const val = km.value || 0;
                    let cls = '';
                    if (med > 0) {
                        const pctDiff = (val - med) / med * 100;
                        const absDiff = Math.abs(pctDiff);
                        if (absDiff < 10) cls = 'ok';
                        else if (pctDiff > 0 && ind.id !== 'ACCESS2') cls = 'poor';
                        else if (pctDiff < 0 && ind.id === 'ACCESS2') cls = 'poor';
                        else cls = 'good';
                    }
                    html += `<td class="indicator ${cls}">${val}%</td>`;
                } else {
                    html += '<td class="indicator">—</td>';
                }
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        $('#state-results').innerHTML = html;

        // Bind clicks
        $$('#state-results tr[data-fips]').forEach(row => {
            row.addEventListener('click', () => loadDetail(row.dataset.fips));
        });
    }

    // ── Proximity search ──
    async function searchNearby() {
        const addr = $('#addr-input').value.trim();
        if (!addr) return;

        $('#intro').classList.add('hidden');
        $('#nearby-results').innerHTML = '<p>Geocoding address…</p>';

        try {
            // Geocode
            const geoResp = await fetch(`${GEOCODE_URL}?format=json&q=${encodeURIComponent(addr)}&limit=1&countrycodes=us`);
            const geoData = await geoResp.json();
            if (!geoData.length) {
                $('#nearby-results').innerHTML = '<p>Address not found. Try a city name or ZIP code.</p>';
                return;
            }

            const lat = parseFloat(geoData[0].lat);
            const lon = parseFloat(geoData[0].lon);
            const displayName = geoData[0].display_name;

            const radius = parseInt($('#radius-select').value) || 50;

            $('#nearby-results').innerHTML = `<p>Finding counties within ${radius} miles of <strong>${displayName}</strong>…</p>`;

            // Determine which state proximity shards to load
            await findNearbyCounties(lat, lon, radius, displayName);

        } catch (e) {
            console.error(e);
            $('#nearby-results').innerHTML = '<p>Error searching. Try again.</p>';
        }
    }

    async function findNearbyCounties(lat, lon, radius, displayName) {
        // Load ALL state proximity files (they're small) and check each county
        if (!allCounties.length) {
            await loadCountyIndex();
        }
        if (!allCounties.length) {
            $('#nearby-results').innerHTML = '<p>County index not available.</p>';
            return;
        }

        // Load detail shards for counties within broad bounds
        // Strategy: check bounding box ±2 degrees (~140mi) to narrow candidates
        const candidateStates = new Set();
        const degPerMile = 1.0 / 69.0;

        // Load all state proximity files (51 files, small)
        const promises = [];
        for (const c of allCounties) {
            const st = c.state;
            if (st && !proximityCache[st]) {
                promises.push(
                    fetch(`${BASE}proximity/${st.toLowerCase()}.json`)
                        .then(r => r.json())
                        .then(data => { proximityCache[st] = data; })
                        .catch(() => {})
                );
            }
        }

        $('#nearby-results').innerHTML = '<p>Loading location data…</p>';
        await Promise.all(promises);

        // Now check all counties in all state caches
        const nearby = [];
        const bboxLat = radius * degPerMile;
        const bboxLon = radius * degPerMile / Math.cos(lat * Math.PI / 180);

        for (const [state, entries] of Object.entries(proximityCache)) {
            for (const entry of entries) {
                const dlat = Math.abs(entry.lat - lat);
                const dlon = Math.abs(entry.lon - lon);
                if (dlat < bboxLat && dlon < bboxLon) {
                    // Compute actual distance
                    const dist = haversineKm(lat, lon, entry.lat, entry.lon);
                    const distMi = dist * 0.621371;
                    if (distMi <= radius) {
                        nearby.push({...entry, distance: Math.round(distMi * 10) / 10});
                    }
                }
            }
        }

        nearby.sort((a, b) => a.distance - b.distance);

        if (nearby.length === 0) {
            $('#nearby-results').innerHTML = `<p>No counties found within ${radius} miles. Try a larger radius.</p>`;
            return;
        }

        // Load search data for first letter of each county to get standout measures
        const neededLetters = new Set();
        nearby.slice(0, 30).forEach(c => {
            const first = c.name[0].toUpperCase();
            if (/[A-Z]/.test(first)) neededLetters.add(first.toLowerCase());
        });

        const searchData = {};
        for (const letter of neededLetters) {
            if (!searchCache[letter]) {
                try {
                    const resp = await fetch(`${BASE}search/${letter}.json`);
                    if (resp.ok) {
                        const d = await resp.json();
                        searchCache[letter] = d.counties || [];
                    }
                } catch (e) {}
            }
            searchData[letter] = searchCache[letter] || [];
        }

        // Build results with standout info
        const resultsHtml = nearby.slice(0, 30).map(c => {
            const first = c.name[0].toUpperCase().toLowerCase();
            const searchEntry = (searchData[first] || []).find(s => s.fips === c.fips);
            return renderCountyCard(searchEntry || {
                fips: c.fips,
                name: c.name,
                state: c.state || '',
                pop: c.pop || 0,
                standout: [],
            }) + `<div class="meta" style="margin-top:-0.3rem;margin-bottom:0.5rem">${c.distance} miles</div>`;
        }).join('');

        $('#nearby-results').innerHTML = `
            <p style="margin-bottom:0.5rem;color:var(--gray-500)">${nearby.length} counties within ${radius} miles of <strong>${displayName}</strong>${nearby.length > 30 ? ' (showing 30 closest)' : ''}</p>
            ${resultsHtml}
        `;
        bindCardClicks();
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dlat = (lat2 - lat1) * Math.PI / 180;
        const dlon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dlat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dlon/2)**2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    }

    // ── County detail ──
    async function loadDetail(fips) {
        $('#results').innerHTML = '';
        $('#state-results').innerHTML = '';
        $('#nearby-results').innerHTML = '';
        $('#intro').classList.add('hidden');
        $('#detail').classList.add('hidden');
        $('#detail-content').innerHTML = '<p>Loading…</p>';
        $('#detail').classList.remove('hidden');

        try {
            // MD5 shard
            const shard = md5shard(fips);
            let data;
            if (detailCache[shard]) {
                data = detailCache[shard][fips];
            } else {
                const resp = await fetch(`${BASE}details/${shard}.json`);
                if (!resp.ok) throw new Error('Not found');
                const shardData = await resp.json();
                detailCache[shard] = shardData;
                data = shardData[fips];
            }

            if (!data) {
                $('#detail-content').innerHTML = '<p>County not found.</p>';
                return;
            }

            renderDetail(fips, data);
        } catch (e) {
            console.error(e);
            $('#detail-content').innerHTML = '<p>Error loading county data.</p>';
        }
    }

    function renderDetail(fips, data) {
        const measures = data.measures || {};
        const medians = meta.national_medians || {};

        // Group measures by category
        const cats = {};
        for (const [mid, mdef] of Object.entries(meta.measures || {})) {
            const cat = mdef.category || 'Other';
            if (!cats[cat]) cats[cat] = [];
            cats[cat].push({id: mid, ...mdef, value: measures[mid]});
        }

        let html = `<div class="detail-header">
            <h2>${data.name}, ${data.state}</h2>
            <p class="pop">Population: ${fmt(data.pop)} &middot; County FIPS: ${fips}</p>
        </div>`;

        for (const [catName, items] of Object.entries(cats)) {
            html += `<div class="category"><h3>${catName}</h3>`;
            items.forEach(item => {
                const mv = item.value;
                if (!mv || mv.value === undefined) return;
                const val = mv.value;
                const med = medians[item.id] || 0;
                const betterDir = item.better || 'lower';
                const ciStr = (mv.low !== null && mv.high !== null) ? ` (${mv.low}–${mv.high})` : '';

                // Color based on comparison to national median
                let barColor = 'var(--green)';
                if (med > 0) {
                    const pctDiff = (val - med) / med * 100;
                    const isGood = (betterDir === 'lower' && val <= med) || (betterDir === 'higher' && val >= med);
                    if (Math.abs(pctDiff) < 10) barColor = 'var(--yellow)';
                    else if (!isGood) barColor = 'var(--red)';
                    else barColor = 'var(--green)';
                }

                // Bar width: scale relative to median (cap at 2x)
                let barPct = med > 0 ? (val / med * 50) : 50;
                barPct = Math.min(barPct, 100);

                // Comparison text
                let compareText = '';
                if (med > 0) {
                    const diff = Math.round((val - med) / med * 100);
                    if (Math.abs(diff) >= 5) {
                        compareText = diff > 0 ? `+${diff}%` : `${diff}%`;
                    }
                }

                html += `<div class="measure-row">
                    <span class="measure-label">${item.label}</span>
                    <span class="measure-value">${val}%</span>
                    <div class="measure-bar"><div class="measure-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div>
                    <span class="measure-compare">${compareText}</span>
                </div>`;
            });
            html += '</div>';
        }

        // Methodology note
        html += `<p class="small" style="margin-top:2rem;padding-top:1rem;border-top:1px solid var(--gray-200);">
            Source: CDC PLACES 2025 release (BRFSS 2023). Values are model-based crude prevalence estimates (%). 
            Confidence intervals shown in parentheses where available. 
            Bar comparisons are relative to the national median across all counties. 
            This is population health data, not individual medical advice.
        </p>`;

        $('#detail-content').innerHTML = html;
        window.scrollTo(0, 0);
    }

    // ── MD5 shard (pure JS, RFC 1321 compatible) ──
    function md5shard(key) {
        // Use SubtleCrypto if available, otherwise simple hash
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            // We need this to be sync for our use case, so use a precomputed approach
            // Actually load a small lookup from the detail directory
            // For now use a simple deterministic shard function compatible with Python hashlib.md5
            return _jsMd5First2(key);
        }
        return _simpleHash(key);
    }

    function _jsMd5First2(str) {
        // RFC 1321 MD5 implementation in pure JS
        function md5cycle(x, k) {
            let a = x[0], b = x[1], c = x[2], d = x[3];
            a = ff(a, b, c, d, k[0], 7, -680876936);
            d = ff(d, a, b, c, k[1], 12, -389564586);
            c = ff(c, d, a, b, k[2], 17, 606105819);
            b = ff(b, c, d, a, k[3], 22, -1044525330);
            a = ff(a, b, c, d, k[4], 7, -176418897);
            d = ff(d, a, b, c, k[5], 12, 1200080426);
            c = ff(c, d, a, b, k[6], 17, -1473231341);
            b = ff(b, c, d, a, k[7], 22, -45705983);
            a = ff(a, b, c, d, k[8], 7, 1770035416);
            d = ff(d, a, b, c, k[9], 12, -1958414417);
            c = ff(c, d, a, b, k[10], 17, -42063);
            b = ff(b, c, d, a, k[11], 22, -1990404162);
            a = ff(a, b, c, d, k[12], 7, 1804603682);
            d = ff(d, a, b, c, k[13], 12, -40341101);
            c = ff(c, d, a, b, k[14], 17, -1502002290);
            b = ff(b, c, d, a, k[15], 22, 1236535329);
            a = gg(a, b, c, d, k[1], 5, -165796510);
            d = gg(d, a, b, c, k[6], 9, -1069501632);
            c = gg(c, d, a, b, k[11], 14, 643717713);
            b = gg(b, c, d, a, k[0], 20, -373897302);
            a = gg(a, b, c, d, k[5], 5, -701558691);
            d = gg(d, a, b, c, k[10], 9, 38016083);
            c = gg(c, d, a, b, k[15], 14, -660478335);
            b = gg(b, c, d, a, k[4], 20, -405537848);
            a = gg(a, b, c, d, k[9], 5, 568446438);
            d = gg(d, a, b, c, k[14], 9, -1019803690);
            c = gg(c, d, a, b, k[3], 14, -187363961);
            b = gg(b, c, d, a, k[8], 20, 1163531501);
            a = gg(a, b, c, d, k[13], 5, -1444681467);
            d = gg(d, a, b, c, k[2], 9, -51403784);
            c = gg(c, d, a, b, k[7], 14, 1735328473);
            b = gg(b, c, d, a, k[12], 20, -1926607734);
            a = hh(a, b, c, d, k[5], 4, -378558);
            d = hh(d, a, b, c, k[8], 11, -2022574463);
            c = hh(c, d, a, b, k[11], 16, 1839030562);
            b = hh(b, c, d, a, k[14], 23, -35309556);
            a = hh(a, b, c, d, k[1], 4, -1530992060);
            d = hh(d, a, b, c, k[4], 11, 1272893353);
            c = hh(c, d, a, b, k[7], 16, -155497632);
            b = hh(b, c, d, a, k[10], 23, -1094730640);
            a = hh(a, b, c, d, k[13], 4, 681279174);
            d = hh(d, a, b, c, k[0], 11, -358537222);
            c = hh(c, d, a, b, k[3], 16, -722521979);
            b = hh(b, c, d, a, k[6], 23, 76029189);
            a = hh(a, b, c, d, k[9], 4, -640364487);
            d = hh(d, a, b, c, k[12], 11, -421815835);
            c = hh(c, d, a, b, k[15], 16, 530742520);
            b = hh(b, c, d, a, k[2], 23, -995338651);
            a = ii(a, b, c, d, k[0], 6, -198630844);
            d = ii(d, a, b, c, k[7], 10, 1126891415);
            c = ii(c, d, a, b, k[14], 15, -1416354905);
            b = ii(b, c, d, a, k[5], 21, -57434055);
            a = ii(a, b, c, d, k[12], 6, 1700485571);
            d = ii(d, a, b, c, k[3], 10, -1894986606);
            c = ii(c, d, a, b, k[10], 15, -1051523);
            b = ii(b, c, d, a, k[1], 21, -2054922799);
            a = ii(a, b, c, d, k[8], 6, 1873313359);
            d = ii(d, a, b, c, k[15], 10, -30611744);
            c = ii(c, d, a, b, k[6], 15, -1560198380);
            b = ii(b, c, d, a, k[13], 21, 1309151649);
            a = ii(a, b, c, d, k[4], 6, -145523070);
            d = ii(d, a, b, c, k[11], 10, -1120210379);
            c = ii(c, d, a, b, k[2], 15, 718787259);
            b = ii(b, c, d, a, k[9], 21, -343485551);
            x[0] = add32(a, x[0]);
            x[1] = add32(b, x[1]);
            x[2] = add32(c, x[2]);
            x[3] = add32(d, x[3]);
        }
        function cmn(q, a, b, x, s, t) {
            a = add32(add32(a, q), add32(x, t));
            return add32((a << s) | (a >>> (32 - s)), b);
        }
        function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
        function md51(s) {
            const n = s.length;
            const state = [1732584193, -271733879, -1732584194, 271733878];
            let i;
            for (i = 64; i <= n; i += 64) {
                md5cycle(state, md5blk(s.substring(i - 64, i)));
            }
            s = s.substring(i - 64);
            const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
            tail[i >> 2] |= 0x80 << ((i % 4) << 3);
            if (i > 55) {
                md5cycle(state, tail);
                for (i = 0; i < 16; i++) tail[i] = 0;
            }
            tail[14] = n * 8;
            md5cycle(state, tail);
            return state;
        }
        function md5blk(s) {
            const md5blks = [];
            for (let i = 0; i < 64; i += 4) {
                md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
            }
            return md5blks;
        }
        function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
        function hex(val) {
            const h = [];
            const hexChars = '0123456789abcdef';
            for (let j = 0; j <= 3; j++) {
                h.push(hexChars.charAt((val >> (j * 8 + 4)) & 0x0F) + hexChars.charAt((val >> (j * 8)) & 0x0F));
            }
            return h.join('');
        }
        const digest = md51(str);
        return hex(digest[0]).substring(0, 2);
    }

    // ── Format ──
    function fmt(n) {
        if (n === undefined || n === null) return '—';
        return n.toLocaleString();
    }

    // ── Start ──
    init();
})();
