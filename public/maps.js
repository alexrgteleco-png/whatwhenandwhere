// WhatWhenAndWhere · mapas (MapLibre GL + OpenFreeMap) y autocompletado de direcciones (Photon vía /geo).
(function () {
  'use strict';

  var STYLE = 'https://tiles.openfreemap.org/styles/liberty';
  var SPAIN = { lat: 40.2, lon: -3.7, zoom: 4.6 };
  var ACCENT = '#e8573f';

  function readJson(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  function hasMapLibre() {
    return typeof window.maplibregl !== 'undefined';
  }

  function newMap(container, opts) {
    var map = new maplibregl.Map({
      container: container,
      style: STYLE,
      center: [opts.lon, opts.lat],
      zoom: opts.zoom,
      attributionControl: { compact: true },
      cooperativeGestures: true, // en móvil, dos dedos para mover; no secuestra el scroll
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    return map;
  }

  // Popup construido con nodos DOM (sin HTML del usuario).
  function popupFor(ev) {
    var box = document.createElement('div');
    box.className = 'map-popup';
    var a = document.createElement('a');
    a.href = '/events/' + ev.id;
    a.textContent = ev.title;
    var meta = document.createElement('p');
    meta.textContent = ev.when + ' · ' + ev.place;
    box.appendChild(a);
    box.appendChild(meta);
    return new maplibregl.Popup({ offset: 24, maxWidth: '260px' }).setDOMContent(box);
  }

  // Polígono aproximado de un círculo de radio km (para el filtro "cerca de").
  function circle(lat, lon, km) {
    var pts = [];
    for (var i = 0; i <= 64; i++) {
      var a = (i / 64) * 2 * Math.PI;
      var dLat = (km / 111.32) * Math.sin(a);
      var dLon = (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a);
      pts.push([lon + dLon, lat + dLat]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] } };
  }

  // ---------------------------------------------------------------- mapas
  function resultsMap(el) {
    var data = readJson('results-data');
    if (!data || !data.events.length) return;
    var first = data.events[0];
    var map = newMap(el, { lat: first.lat, lon: first.lon, zoom: 12 });
    var bounds = new maplibregl.LngLatBounds();
    data.events.forEach(function (ev) {
      new maplibregl.Marker({ color: ACCENT }).setLngLat([ev.lon, ev.lat]).setPopup(popupFor(ev)).addTo(map);
      bounds.extend([ev.lon, ev.lat]);
    });
    if (data.center) {
      var c = data.center;
      var area = circle(c.lat, c.lon, c.radiusKm);
      area.geometry.coordinates[0].forEach(function (p) { bounds.extend(p); });
      map.on('load', function () {
        map.addSource('radius', { type: 'geojson', data: area });
        map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': ACCENT, 'fill-opacity': 0.07 } });
        map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': ACCENT, 'line-width': 1.5, 'line-dasharray': [2, 2] } });
      });
    }
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }

  function eventMap(el) {
    var data = readJson('event-data');
    if (!data) return;
    var map = newMap(el, { lat: data.lat, lon: data.lon, zoom: 15 });
    new maplibregl.Marker({ color: ACCENT }).setLngLat([data.lon, data.lat]).addTo(map);
  }

  var pickers = {};

  function pickerMap(el) {
    var wrap = el.closest('[data-geo-autocomplete]');
    var latInput = wrap.querySelector('[data-geo-lat]');
    var lonInput = wrap.querySelector('[data-geo-lon]');
    var hint = wrap.querySelector('[data-geo-hint]');
    var lat = parseFloat(latInput.value);
    var lon = parseFloat(lonInput.value);
    var has = isFinite(lat) && isFinite(lon);
    var map = newMap(el, has ? { lat: lat, lon: lon, zoom: 15 } : SPAIN);
    var marker = new maplibregl.Marker({ color: ACCENT, draggable: true });

    function place(newLat, newLon, fly) {
      latInput.value = newLat.toFixed(6);
      lonInput.value = newLon.toFixed(6);
      marker.setLngLat([newLon, newLat]).addTo(map);
      if (fly) map.flyTo({ center: [newLon, newLat], zoom: Math.max(map.getZoom(), 15) });
      if (hint) hint.textContent = 'Ubicación marcada en el mapa. Puedes arrastrar el marcador para afinarla.';
    }

    if (has) marker.setLngLat([lon, lat]).addTo(map);
    marker.on('dragend', function () {
      var p = marker.getLngLat();
      place(p.lat, p.lng, false);
    });
    map.on('click', function (e) { place(e.lngLat.lat, e.lngLat.lng, false); });

    pickers[el.id] = {
      set: function (newLat, newLon) { place(newLat, newLon, true); },
      clear: function () {
        marker.remove();
        if (hint) hint.textContent = 'Elige una sugerencia para situar el evento en el mapa. Si es online, escríbelo sin más.';
      },
      center: function () {
        var c = map.getCenter();
        return { lat: c.lat, lon: c.lng };
      },
    };
  }

  function initMaps() {
    if (!hasMapLibre()) return; // sin la librería, la página sigue funcionando sin mapas
    document.querySelectorAll('[data-map]').forEach(function (el) {
      try {
        if (el.dataset.map === 'results') resultsMap(el);
        else if (el.dataset.map === 'event') eventMap(el);
        else if (el.dataset.map === 'picker') pickerMap(el);
      } catch (err) {
        el.hidden = true;
        console.error('Mapa no disponible:', err);
      }
    });
  }

  // ---------------------------------------------------------------- autocompletado
  function initAutocomplete(wrap) {
    var input = wrap.querySelector('[data-geo-input]');
    var list = wrap.querySelector('.suggestions');
    var latInput = wrap.querySelector('[data-geo-lat]');
    var lonInput = wrap.querySelector('[data-geo-lon]');
    var locate = wrap.querySelector('[data-geo-locate]');
    var picker = function () { return pickers[wrap.dataset.geoMap]; };
    var results = [];
    var active = -1;
    var lastQuery = '';

    function close() {
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    }

    function choose(r) {
      input.value = r.label;
      latInput.value = r.lat;
      lonInput.value = r.lon;
      close();
      if (picker()) picker().set(r.lat, r.lon);
    }

    function highlight(i) {
      var items = list.querySelectorAll('li');
      items.forEach(function (li, idx) { li.setAttribute('aria-selected', idx === i ? 'true' : 'false'); });
      active = i;
      if (items[i]) items[i].scrollIntoView({ block: 'nearest' });
    }

    function render(items) {
      results = items;
      list.innerHTML = '';
      if (!items.length) { close(); return; }
      items.forEach(function (r, i) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = input.id + '-opt-' + i;
        li.textContent = r.label;
        li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(r); });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }

    var fetchSuggestions = debounce(function (q) {
      var url = '/geo/search?q=' + encodeURIComponent(q);
      var p = picker();
      if (p) {
        var c = p.center();
        url += '&lat=' + c.lat.toFixed(3) + '&lon=' + c.lon.toFixed(3);
      }
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (items) { if (input.value.trim() === q) render(Array.isArray(items) ? items : []); })
        .catch(function () { close(); });
    }, 250);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');

    input.addEventListener('input', function () {
      // Si se edita el texto, la ubicación elegida deja de valer.
      latInput.value = '';
      lonInput.value = '';
      if (picker()) picker().clear();
      var q = input.value.trim();
      if (q.length < 3 || /^online$/i.test(q)) { close(); return; }
      if (q === lastQuery) return;
      lastQuery = q;
      fetchSuggestions(q);
    });

    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(active + 1, results.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(results[active]); }
      else if (e.key === 'Escape') { close(); }
    });

    input.addEventListener('blur', function () { setTimeout(close, 150); });

    if (locate) {
      locate.addEventListener('click', function () {
        if (!navigator.geolocation) return;
        locate.disabled = true;
        input.placeholder = 'Buscando tu ubicación…';
        navigator.geolocation.getCurrentPosition(function (pos) {
          var lat = pos.coords.latitude;
          var lon = pos.coords.longitude;
          latInput.value = lat.toFixed(6);
          lonInput.value = lon.toFixed(6);
          fetch('/geo/reverse?lat=' + lat + '&lon=' + lon)
            .then(function (r) { return r.ok ? r.json() : {}; })
            .then(function (r) { input.value = (r && r.label) || 'Mi ubicación'; })
            .catch(function () { input.value = 'Mi ubicación'; })
            .finally(function () { locate.disabled = false; });
        }, function () {
          locate.disabled = false;
          input.placeholder = 'No se pudo obtener tu ubicación';
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
      });
    }
  }

  initMaps();
  document.querySelectorAll('[data-geo-autocomplete]').forEach(initAutocomplete);
})();
