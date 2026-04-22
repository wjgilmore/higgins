const WMO = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

async function geocodeZip(zip) {
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (res.status === 404) throw new Error(`Zip code ${zip} not found`);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = await res.json();
  const place = data.places?.[0];
  if (!place) throw new Error(`No location data for zip ${zip}`);
  return {
    lat: parseFloat(place.latitude),
    lon: parseFloat(place.longitude),
    city: place["place name"],
    state: place["state abbreviation"],
  };
}

async function fetchForecast({ lat, lon, days }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily:
      "temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,sunrise,sunset",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "auto",
    forecast_days: String(Math.min(Math.max(days, 1), 7)),
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error(`Forecast fetch failed (${res.status})`);
  return res.json();
}

export default {
  name: "weather",
  description:
    "Get the current weather and multi-day forecast for a US zip code. Use this whenever the user asks about weather, temperature, rain, or outdoor conditions.",
  parameters: {
    type: "object",
    properties: {
      zip: {
        type: "string",
        description: "US 5-digit zip code, e.g. '10001'.",
      },
      days: {
        type: "integer",
        description: "Number of forecast days to include (1–7). Defaults to 3.",
      },
    },
    required: ["zip"],
  },
  async handler(args) {
    const zip = String(args?.zip ?? "").trim();
    if (!/^\d{5}$/.test(zip)) {
      return `ERROR: '${zip}' is not a valid 5-digit US zip code.`;
    }
    const days = Number.isFinite(args?.days) ? args.days : 3;
    const loc = await geocodeZip(zip);
    const fc = await fetchForecast({ lat: loc.lat, lon: loc.lon, days });
    const cur = fc.current ?? {};
    const d = fc.daily ?? {};

    return JSON.stringify(
      {
        location: `${loc.city}, ${loc.state} ${zip}`,
        timezone: fc.timezone,
        current: {
          temp_f: cur.temperature_2m,
          feels_like_f: cur.apparent_temperature,
          conditions: WMO[cur.weather_code] ?? `code ${cur.weather_code}`,
          wind_mph: cur.wind_speed_10m,
          observed_at: cur.time,
        },
        daily: (d.time ?? []).map((date, i) => {
          const dayName = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
          return {
          date,
          day_name: dayName,
          high_f: d.temperature_2m_max?.[i],
          low_f: d.temperature_2m_min?.[i],
          conditions: WMO[d.weather_code?.[i]] ?? `code ${d.weather_code?.[i]}`,
          precip_chance_pct: d.precipitation_probability_max?.[i],
          sunrise: d.sunrise?.[i],
          sunset: d.sunset?.[i],
        }; }),
      },
      null,
      2,
    );
  },
};
