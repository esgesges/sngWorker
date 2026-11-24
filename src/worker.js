// Funzione ausiliaria per calcolare la distanza in chilometri (Formula dell'Haversine)
function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Raggio della Terra in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distanza in km
}

function sendTelegramMessage(message) {
    const key = "a4d706ae3506b2b45776ef253358f094";
    fetch(`https://api.telegram.org/bot8642017775:AAFAxONiblY8Yg0bxWS42QleMLnNOnveoFI/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: 716727488,
        text: message
      })
    });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    //    --- USER REQUESTS
    // GET /users -- print all the users
    if (url.pathname === "/users" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM user").all();
      return Response.json(results);
    }
    // POST /signup -- add a user
    if (url.pathname === "/signup" && request.method === "POST") {
      try {
        const { name, surname, password, email } = await request.json();

        if (!name || !surname || !password || !email) {
          return Response.json({ userid: null, error: "Missing required fields" }, { status: 400 });
        }

        const result = await env.DB
          .prepare("INSERT INTO User (nome, cognome, password, email) VALUES (?,?,?,?)")
          .bind(name, surname, password, email)
          .run();

        if (result.success) {
          return Response.json({ userid: result.meta.last_row_id }, { status: 201 });
        }
        return Response.json({ userid: null }, { status: 500 });
      } catch (err) {
        // es. violazione UNIQUE su email
        return Response.json({ userid: null, error: err.message }, { status: 500 });
      }
    }
    // POST /login -- check if a user exists
    if (url.pathname === "/login" && request.method === "POST") {
      try {
        const { nome, password } = await request.json();

        if (!nome || !password) {
          return Response.json({ userid: null, error: `Missing required fields, input: ${nome} - ${password}` }, { status: 400 });
        }

        const row = await env.DB
          .prepare("SELECT id FROM User WHERE nome = ? AND password = ?")
          .bind(nome, password)
          .first();

        if (row) {
          return Response.json({ userId: row.Id }, { status: 200 });
        }
        return Response.json({ userid: null }, { status: 404 });
      } catch (err) {
        return Response.json({ userid: null, error: err.message }, { status: 500 });
      }
    }

    //    --- EVENT REQUESTS
    // GET /places -- print all the events
    if (url.pathname === "/events" && request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM Evento").all();
      return Response.json(results);
    }
    // POST /addevent -- add an event
    if (url.pathname === "/addevent" && request.method === "POST") {
      try {
        // 1. Extract JSON body from incoming request
        const body = await request.json();
        const { name, lat, lon, userId } = body;

        if (!name || lat == null || lon == null || userId == null) {
          return Response.json({ error: "Missing required fields" }, { status: 400 });
        }

        const result = await env.DB.prepare("INSERT INTO Evento (name, lat, lon) VALUES (?, ?, ?)")
          .bind(name, lat, lon)
          .run();

        await env.DB.prepare("INSERT INTO Partecipanti (UserId, EventId) VALUES (?,?)")
          .bind(userId, result.meta.last_row_id)
          .run();

        sendTelegramMessage(`${name} - ${userId}`);
        return Response.json({ message: "Place added successfully" }, { status: 201 });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }
    // POST /participate -- participate to an event
    if (url.pathname === "/participate" && request.method === "POST") {
      try {
        const body = await request.json();
        const { userId, eventId } = body;

        if (userId == null || eventId == null) {
          return Response.json({ error: "Missing required fields" }, { status: 400 });
        }

        const result = await env.DB.prepare("INSERT INTO Partecipanti (UserId, EventId) VALUES (?,?)")
          .bind(userId, eventId)
          .run();

        if (result.success) {
          return Response.json({ response: "Participate added successfully" }, { status: 201 });
        }
        return Response.json({ messresponseage: "Participate added failed" }, { status: 500 });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }
    // POST /placeexists -- check if an event exists at lat/lon and return its data
    if (url.pathname === "/placeexists" && request.method === "POST") {
      try {       
        const body = await request.json();
        const { lat, lon } = body;

        if (lat == null || lon == null) {
          return Response.json({ error: "Missing required fields" }, { status: 400 });
        }

        // Fetch the matching event
        const row = await env.DB.prepare("SELECT * FROM Evento WHERE lat = ? AND lon = ?")
          .bind(lat, lon)
          .first();

        if (row) {
          const participants = await env.DB.prepare(
            "SELECT p.UserId AS id, u.nome AS name FROM Partecipanti p JOIN User u ON p.UserId = u.id WHERE p.EventId = ?"
          )
            .bind(row.id)
            .all();

          return Response.json({
            exists: true,
            event: {
              id: row.id,
              name: row.name,
              desc: row.desc,
              date: row.date,
              time: row.time,
              lat: row.lat,
              lon: row.lon,
              participants: participants.results.map(p => ({
                id: p.id,
                name: p.name || "Unknown"
              }))
            }
          }, { status: 200 });
        } else {
          return Response.json({ exists: false, event: null }, { status: 200 });
        }
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }
    // POST /getreccomended -- get bundle of 20 events near user for tinder-like mode
    if (url.pathname === "/getrecommended" && request.method === "POST") {
      try {
        const body = await request.json();
        const { lat, lon, pos } = body;

        // Validazione dei campi obbligatori
        if (lat == null || lon == null || pos == null) {
          return Response.json({ error: "Missing required fields" }, { status: 400 });
        }

        const userLat = parseFloat(lat);
        const userLon = parseFloat(lon);
        const pageIndex = parseInt(pos, 10); // 0 per i primi 20, 1 per i successivi 20, ecc.
        const pageSize = 20;

        // 1. Recupera tutti i posti dal database
        const { results: places } = await env.DB.prepare("SELECT * FROM Evento").all();

        if (!places || places.length === 0) {
          return Response.json({ places: [], hasMore: false }, { status: 200 });
        }

        // 2. Calcola la distanza per ciascun posto
        const placesWithDistance = places.map((place) => {
          const distance = getDistanceInKm(
            userLat,
            userLon,
            parseFloat(place.lat),
            parseFloat(place.lon)
          );
          return { ...place, distance: Math.round(distance * 100) / 100 }; // Distanza arrotondata a 2 decimali (in km)
        });

        // 3. Ordina i posti dal più vicino al più lontano
        placesWithDistance.sort((a, b) => a.distance - b.distance);

        // 4. Applica la paginazione (Offset e Limit)
        const startIndex = pageIndex * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedPlaces = placesWithDistance.slice(startIndex, endIndex);

        return Response.json(
          {
            places: paginatedPlaces,
          },
          { status: 200 }
        );
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }
    return new Response("Not Found", { status: 404 });
  }
};
