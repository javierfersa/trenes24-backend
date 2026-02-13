import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const FEEDS = {
  vehicles: "https://gtfsrt.renfe.com/vehicle_positions.json",
  updates: "https://gtfsrt.renfe.com/trip_updates.json",
  alerts: "https://gtfsrt.renfe.com/alerts.json"
};

// Caché simple en memoria
const CACHE = {
  trenes: { data: null, ts: 0 },
  incidencias: { data: null, ts: 0 }
};
const CACHE_MS = 30 * 1000; // 30 segundos

async function getJSON(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    console.error("Error al obtener", url, e.message);
    return { error: true };
  }
}

function logTrenVacio(v) {
  if (!v.trip?.trip_id) {
    console.log("Tren sin trip_id:", JSON.stringify(v).slice(0, 200));
  }
}

// Procesa feeds y devuelve { trenes, incidencias }
async function buildData() {
  const [vehicles, updates, alerts] = await Promise.all([
    getJSON(FEEDS.vehicles),
    getJSON(FEEDS.updates),
    getJSON(FEEDS.alerts)
  ]);

  const trenes = {};

  // VEHICLES → trenes base
  if (vehicles.entity) {
    vehicles.entity.forEach(ent => {
      if (!ent.vehicle) return;
      const v = ent.vehicle;

      if (!v.trip?.trip_id) {
        logTrenVacio(v);
        return; // filtramos trenes sin trip_id
      }

      const trip = v.trip.trip_id;
      const linea = trip.split("_")[0] || "??";

      trenes[trip] = {
        trip_id: trip,
        linea,
        lat: v.position?.latitude || null,
        lon: v.position?.longitude || null,
        estado: v.current_status || "UNKNOWN",
        retraso: 0
      };
    });
  }

  // UPDATES → retrasos
  if (updates.entity) {
    updates.entity.forEach(ent => {
      if (!ent.trip_update) return;
      const tu = ent.trip_update;
      const trip = tu.trip?.trip_id;
      if (!trip || !trenes[trip]) return;

      tu.stop_time_update?.forEach(stu => {
        if (stu.arrival?.delay) {
          trenes[trip].retraso = Math.floor(stu.arrival.delay / 60);
        }
      });
    });
  }

  // ALERTS → incidencias limpias
  const incidenciasRaw = [];
  if (alerts.entity) {
    alerts.entity.forEach(ent => {
      if (!ent.alert) return;
      const a = ent.alert;

      const linea = a.informed_entity?.[0]?.route_id || "??";
      const descripcion = a.header_text?.translation?.[0]?.text || "";

      if (!descripcion.trim()) return; // filtramos vacías

      incidenciasRaw.push({ linea, descripcion });
    });
  }

  // Eliminar incidencias duplicadas
  const seen = new Set();
  const incidencias = incidenciasRaw.filter(inc => {
    const key = inc.linea + "|" + inc.descripcion;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Ordenar trenes por línea y trip_id
  const trenesOrdenados = Object.values(trenes).sort((a, b) => {
    if (a.linea === b.linea) return a.trip_id.localeCompare(b.trip_id);
    return a.linea.localeCompare(b.linea);
  });

  return { trenes: trenesOrdenados, incidencias };
}

// Middleware de caché simple
async function getCachedData() {
  const now = Date.now();
  if (CACHE.trenes.data && now - CACHE.trenes.ts < CACHE_MS) {
    return {
      trenes: CACHE.trenes.data,
      incidencias: CACHE.incidencias.data
    };
  }

  const { trenes, incidencias } = await buildData();
  CACHE.trenes = { data: trenes, ts: now };
  CACHE.incidencias = { data: incidencias, ts: now };
  return { trenes, incidencias };
}

// Endpoint principal
app.get("/api/trenes", async (req, res) => {
  const { trenes, incidencias } = await getCachedData();
  res.json({
    timestamp: Date.now(),
    trenes,
    incidencias
  });
});

// Endpoint solo incidencias
app.get("/api/incidencias", async (req, res) => {
  const { incidencias } = await getCachedData();
  res.json({
    timestamp: Date.now(),
    incidencias
  });
});

// Endpoint solo líneas (únicas)
app.get("/api/lineas", async (req, res) => {
  const { trenes } = await getCachedData();
  const lineasSet = new Set(trenes.map(t => t.linea));
  res.json({
    timestamp: Date.now(),
    lineas: Array.from(lineasSet).sort()
  });
});

// Raíz informativa
app.get("/", (req, res) => {
  res.send("Backend trenes24-backend operativo. Usa /api/trenes, /api/incidencias o /api/lineas");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend GTFS-RT listo en puerto " + PORT));
