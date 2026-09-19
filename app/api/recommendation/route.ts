import { CAMPUS_RESTAURANTS, distanceInMeters } from "@/lib/campus-restaurants";

type WeatherItem = { category: string; fcstDate: string; fcstTime: string; fcstValue: string };

function kstDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10).replaceAll("-", ""),
    time: shifted.toISOString().slice(11, 16).replace(":", ""),
  };
}

async function getWeather() {
  const apiKey = process.env.KMA_API_KEY;
  if (!apiKey) throw new Error("KMA_API_KEY가 설정되지 않았습니다.");
  const base = new Date(Date.now() - 45 * 60 * 1000);
  const parts = kstDateParts(base);
  const baseTime = `${parts.time.slice(0, 2)}30`;
  const query = new URLSearchParams({ serviceKey: apiKey, pageNo: "1", numOfRows: "60", dataType: "JSON", base_date: parts.date, base_time: baseTime, nx: "59", ny: "125" });
  const response = await fetch(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst?${query}`, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    let reason = "";
    try {
      const parsed = JSON.parse(detail);
      reason = parsed?.response?.header?.resultMsg ?? parsed?.result?.message ?? "";
    } catch { /* non-JSON error */ }
    throw new Error(reason || `기상청 날씨를 불러오지 못했습니다. (${response.status})`);
  }
  const data = await response.json();
  const items: WeatherItem[] = data?.response?.body?.items?.item ?? data?.body?.items?.item ?? [];
  if (!items.length) throw new Error(data?.response?.header?.resultMsg ?? "날씨 예보가 비어 있습니다.");
  const nextTime = [...new Set(items.map((item) => `${item.fcstDate}${item.fcstTime}`))].sort()[0];
  const values = Object.fromEntries(items.filter((item) => `${item.fcstDate}${item.fcstTime}` === nextTime).map((item) => [item.category, item.fcstValue]));
  const precipitation = ({ "0": "없음", "1": "비", "2": "비/눈", "3": "눈", "5": "빗방울", "6": "빗방울/눈날림", "7": "눈날림" } as Record<string, string>)[values.PTY] ?? "알 수 없음";
  const sky = ({ "1": "맑음", "3": "구름 많음", "4": "흐림" } as Record<string, string>)[values.SKY] ?? "알 수 없음";
  return { temperature: values.T1H, humidity: values.REH, rainfall: values.RN1, windSpeed: values.WSD, precipitation, sky, forecastAt: nextTime };
}

export async function POST(request: Request) {
  try {
    const { latitude, longitude, preference = "" } = await request.json();
    const origin = {
      latitude: Number.isFinite(latitude) ? latitude : 37.4564,
      longitude: Number.isFinite(longitude) ? longitude : 126.9515,
    };
    const restaurants = CAMPUS_RESTAURANTS.map((restaurant) => ({ ...restaurant, distance: distanceInMeters(origin, restaurant) })).sort((a, b) => a.distance - b.distance);
    let weather;
    let weatherError = "";
    try {
      weather = await getWeather();
    } catch (error) {
      weatherError = error instanceof Error ? error.message : "날씨를 불러오지 못했습니다.";
      weather = { temperature: undefined, humidity: undefined, rainfall: undefined, windSpeed: undefined, precipitation: "확인 불가", sky: "날씨 확인 불가", forecastAt: undefined };
    }
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

    const prompt = `당신은 서울대학교 관악캠퍼스의 친근하고 현실적인 점심 추천 도우미입니다. 현재 날씨, 사용자의 위치에서 계산한 직선거리, 식당 특징만 근거로 식당 한 곳을 추천하세요. 비나 눈, 강풍, 폭염·한파에는 가까운 곳을 우선하세요. 사용자 요청이 있으면 반영하세요. 반드시 제공된 식당 중 하나만 고르세요.\n\n날씨: ${JSON.stringify(weather)}\n사용자 요청: ${String(preference).slice(0, 200) || "없음"}\n식당: ${JSON.stringify(restaurants)}\n\nJSON으로만 답하세요: {"restaurantId":"식당 id","reason":"한국어 2문장 이내","weatherTip":"한국어 한 문장"}`;
    const geminiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.35 } }),
      cache: "no-store",
    });
    if (!geminiResponse.ok) {
      const detail = await geminiResponse.text();
      throw new Error(`Gemini 추천을 받지 못했습니다. (${geminiResponse.status}: ${detail.slice(0, 120)})`);
    }
    const geminiData = await geminiResponse.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    const recommendation = JSON.parse(text);
    if (!restaurants.some((restaurant) => restaurant.id === recommendation.restaurantId)) throw new Error("Gemini가 알 수 없는 식당을 추천했습니다.");
    return Response.json({ weather, weatherError, restaurants, recommendation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "추천을 만들지 못했습니다.";
    return Response.json({ error: message }, { status: 500 });
  }
}
