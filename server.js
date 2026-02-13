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

async function getJSON(url) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return { error: true };
  }
}

app.get("/api/trenes", async (req, res) => {
  const vehicles = await getJSON(FEEDS.vehicles);
  const updates = await getJSON(FEEDS.updates);
  const alerts = await getJSON(FEEDS.alerts);

  const trenes = {};

  // VEHICLES
  if (vehicles.entity) {
    vehicles.entity.forEach(ent => {
      if (!ent.vehicle) return;
      const v = ent.vehicle;
      const trip = v.trip?.trip_id || "DESCONOCIDO";

      trenes[trip] = {
        trip_id: trip,
        linea: trip.split("_")[0] || "??",
        lat: v.position?.latitude || null,
        lon: v.position?.longitude || null,
        estado: v.current_status || "UNKNOWN",
        retraso: 0
      };
    });
  }

  // UPDATES
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

  // ALERTS
  const incidencias = [];
  if (alerts.entity) {
    alerts.entity.forEach(ent => {
      if (!ent.alert) return;
      const a = ent.alert;

      incidencias.push({
        linea: a.informed_entity?.[0]?.route_id || "??",
        descripcion: a.header_text?.translation?.[0]?.text || ""
      });
    });
  }

  res.json({
    timestamp: Date.now(),
    trenes: Object.values(trenes),
    incidencias
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Backend GTFS-RT listo en puerto " + PORT));
