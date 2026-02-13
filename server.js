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

// Caché simple
const CACHE = { data: null, ts: 0 };
const CACHE_MS = 30 * 1000;

async function getJSON(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    console.error("Error al obtener", url, e.message);
    return { entity: [] };
  }
}

// Deducir línea a partir del tripId
function deducirLinea(trip) {
  if (!trip) return "??";

  // Buscar última C o R seguida de números/letras
  const match = trip.match(/([CR])([0-9A-Z]+)$/);
  if (!match) return "??";

  return match[1] + match[2]; // Ej: C1, C5, R4, R2N
}

async function buildData() {
  const [vehicles, updates, alerts] = await Promise.all([
    getJSON(FEEDS.vehicles),
    getJSON(FEEDS.updates),
    getJSON(FEEDS.alerts)
  ]);

  const trenes = {};

  // VEHICLES → trenes base
  vehicles.entity?.forEach(ent => {
    if (!ent.vehicle) return;
    const v = ent.vehicle;

    // tripId real
    let trip = v.trip?.tripId || null;

    // Si no hay tripId, lo reconstruimos con lat/lon
    if (!trip) {
      const lat = v.position?.latitude;
      const lon = v.position?.longitude;
      if (!lat || !lon) return;
      trip = `SINID_${lat.toFixed(3)}_${lon.toFixed(3)}`;
    }

    const linea = deducirLinea(trip);

    trenes[trip] = {
      trip_id: trip,
      linea,
      lat: v.position?.latitude || null,
      lon: v.position?.longitude || null,
      estado: v.currentStatus || "UNKNOWN",
      retraso: 0
    };
  });

  // UPDATES → retrasos
  updates.entity?.forEach(ent => {
    if (!ent.tripUpdate) return;
    const tu = ent.tripUpdate;

    const trip = tu.trip?.tripId;
    if (!trip || !trenes[trip]) return;

    tu.stopTimeUpdate?.forEach(stu => {
      if (stu.arrival?.delay) {
        trenes[trip].retraso = Math.floor(stu.arrival.delay / 60);
      }
    });
  });

  // ALERTS → incidencias limpias
  const incidenciasRaw = [];
  alerts.entity?.forEach(ent => {
    if (!ent.alert) return;
    const a = ent.alert;

    const linea = a.informedEntity?.[0]?.routeId || "??";
    const descripcion =
      a.descriptionText?.translation?.[0]?.text ||
      a.headerText?.translation?.[0]?.text ||
      "";

    if (!descripcion.trim()) return;

    incidenciasRaw.push({ linea, descripcion });
  });

  // Quitar duplicados
  const seen = new Set();
  const incidencias = incidenciasRaw.filter(inc => {
    const key = inc.linea + "|" + inc.descripcion;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    trenes: Object.values(trenes),
    incidencias
  };
}

async function getCached() {
  const now = Date.now();
  if (CACHE.data && now - CACHE.ts < CACHE_MS) return CACHE.data;

  const data = await buildData();
  CACHE.data = data;
  CACHE.ts = now;
  return data;
}

app.get("/api/trenes", async (req, res) => {
  const data = await getCached();
  res.json({ timestamp: Date.now(), ...data });
});

app.get("/api/incidencias", async (req, res) => {
  const data = await getCached();
  res.json({ timestamp: Date.now(), incidencias: data.incidencias });
});

app.get("/api/lineas", async (req, res) => {
  const data = await getCached();
  const lineas = [...new Set(data.trenes.map(t => t.linea))].sort();
  res.json({ timestamp: Date.now(), lineas });
});

app.get("/", (req, res) => {
  res.send("Backend trenes24-backend operativo. Endpoints: /api/trenes /api/incidencias /api/lineas");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend GTFS-RT listo en puerto " + PORT));


