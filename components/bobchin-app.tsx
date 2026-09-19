"use client";

import Script from "next/script";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";
import { importEverytimeImage, type ImportedSchedule } from "@/lib/timetable-import";

declare global {
  interface Window {
    kakao?: any;
  }
}

type User = {
  id: string;
  displayName: string;
  inviteCode: string;
  latitude: number | null;
  longitude: number | null;
  sharing: boolean;
};

type Friend = Omit<User, "inviteCode"> & { lastSeen: string | null };
type Schedule = {
  id: string;
  courseName: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  room: string;
};

type RecommendedRestaurant = {
  id: string;
  name: string;
  building: string;
  description: string;
  tags: string[];
  distance: number;
};

type RecommendationResult = {
  weather: { temperature?: string; humidity?: string; precipitation: string; sky: string };
  weatherError?: string;
  restaurants: RecommendedRestaurant[];
  recommendation: { restaurantId: string; reason: string; weatherTip: string };
};

type ProfileRow = {
  id: string;
  display_name: string;
  invite_code: string;
};

type LocationRow = {
  latitude: number | null;
  longitude: number | null;
  sharing: boolean;
  updated_at: string;
};

type FriendProfile = Pick<ProfileRow, "id" | "display_name"> & {
  locations: LocationRow | LocationRow[] | null;
};

type FriendshipRow = {
  friend_id: string;
  friend: FriendProfile | FriendProfile[] | null;
};

type ScheduleRow = {
  id: string;
  course_name: string;
  weekday: number;
  starts_at: string;
  ends_at: string;
  room: string;
};

const CAMPUS = { lat: 37.4564, lng: 126.9515 };
const WEEKDAYS = ["월", "화", "수", "목", "금"];

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "요청을 처리하지 못했어요.";
  if (/ends_at|weekday/i.test(message) && /column|schema|cache|exist/i.test(message)) {
    return "새 시간표 migration SQL을 Supabase SQL Editor에서 먼저 실행해 주세요.";
  }
  return message;
}

function isFiveMinuteTime(value: string) {
  const parts = value.split(":");
  return parts.length === 2 && Number(parts[1]) % 5 === 0;
}

export default function BobchinApp() {
  const [user, setUser] = useState<User | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [notice, setNotice] = useState("");
  const [booting, setBooting] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [importedSchedules, setImportedSchedules] = useState<ImportedSchedule[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [recommendation, setRecommendation] = useState<RecommendationResult | null>(null);
  const [recommending, setRecommending] = useState(false);
  const [foodPreference, setFoodPreference] = useState("");
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const inviteInFlightRef = useRef("");
  const scheduleDialog = useRef<HTMLDialogElement>(null);
  const importDialog = useRef<HTMLDialogElement>(null);
  const timetableImageInput = useRef<HTMLInputElement>(null);

  const toast = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2800);
  }, []);

  const refresh = useCallback(async (knownUserId?: string) => {
    setRefreshing(true);
    try {
      const supabase = getSupabase();
      let userId = knownUserId;

      if (!userId) {
        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        userId = data.user?.id;
      }

      if (!userId) throw new Error("로그인 세션을 찾지 못했어요.");

      const [profileResult, locationResult, friendshipResult, scheduleResult] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("id, display_name, invite_code")
            .eq("id", userId)
            .single(),
          supabase
            .from("locations")
            .select("latitude, longitude, sharing, updated_at")
            .eq("user_id", userId)
            .maybeSingle(),
          supabase
            .from("friendships")
            .select(
              "friend_id, friend:profiles!friendships_friend_id_fkey(id, display_name, locations(latitude, longitude, sharing, updated_at))",
            )
            .eq("user_id", userId),
          supabase
            .from("schedules")
            .select("id, course_name, weekday, starts_at, ends_at, room")
            .eq("user_id", userId)
            .order("weekday")
            .order("starts_at"),
        ]);

      const failure = [
        profileResult.error,
        locationResult.error,
        friendshipResult.error,
        scheduleResult.error,
      ].find(Boolean);
      if (failure) throw failure;

      const profile = profileResult.data as ProfileRow;
      const ownLocation = locationResult.data as LocationRow | null;
      const friendshipRows = (friendshipResult.data ?? []) as unknown as FriendshipRow[];
      const scheduleRows = (scheduleResult.data ?? []) as ScheduleRow[];

      setUser({
        id: profile.id,
        displayName: profile.display_name,
        inviteCode: profile.invite_code,
        latitude: ownLocation?.latitude ?? null,
        longitude: ownLocation?.longitude ?? null,
        sharing: ownLocation?.sharing ?? false,
      });
      setFriends(
        friendshipRows.flatMap((row) => {
          const friend = first(row.friend);
          if (!friend) return [];
          const friendLocation = first(friend.locations);
          return [
            {
              id: friend.id,
              displayName: friend.display_name,
              latitude: friendLocation?.latitude ?? null,
              longitude: friendLocation?.longitude ?? null,
              sharing: friendLocation?.sharing ?? false,
              lastSeen: friendLocation?.updated_at ?? null,
            },
          ];
        }),
      );
      setSchedules(
        scheduleRows.map((schedule) => ({
          id: schedule.id,
          courseName: schedule.course_name,
          weekday: schedule.weekday,
          startsAt: schedule.starts_at.slice(0, 5),
          endsAt: schedule.ends_at.slice(0, 5),
          room: schedule.room,
        })),
      );
      setFatalError("");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const bootstrap = useCallback(async () => {
    setBooting(true);
    setFatalError("");
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      setPendingInvite(new URLSearchParams(location.search).get("invite"));
      if (data.session?.user) await refresh(data.session.user.id);
    } catch (error) {
      setFatalError(errorMessage(error));
    } finally {
      setBooting(false);
    }
  }, [refresh]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!user || !pendingInvite || inviteInFlightRef.current === pendingInvite) {
      return;
    }

    inviteInFlightRef.current = pendingInvite;
    const acceptInvite = async () => {
      try {
        const { error } = await getSupabase().rpc("accept_friend_invite", {
          p_invite_code: pendingInvite,
        });
        if (error) throw error;
        await refresh(user.id);
        toast("친구가 추가됐어요.");
        history.replaceState({}, "", location.pathname);
        setPendingInvite(null);
      } catch (error) {
        toast(errorMessage(error));
        inviteInFlightRef.current = "";
      }
    };

    void acceptInvite();
  }, [pendingInvite, refresh, toast, user]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => {
      void refresh(user.id).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh, user?.id]);

  const initMap = () => {
    if (!window.kakao?.maps) {
      setMapError("카카오 지도 SDK를 불러오지 못했어요.");
      return;
    }
    window.kakao.maps.load(() => {
      const container = document.getElementById("map");
      if (!container) return;
      mapRef.current = new window.kakao.maps.Map(container, {
        center: new window.kakao.maps.LatLng(CAMPUS.lat, CAMPUS.lng),
        level: 4,
      });
      setMapReady(true);
      setMapError("");
    });
  };

  useEffect(() => {
    if (!mapReady || !window.kakao || !user) return;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    const people = [user, ...friends].filter(
      (person) =>
        person.sharing && person.latitude != null && person.longitude != null,
    );
    overlaysRef.current = people.map((person, index) => {
      const marker = document.createElement("div");
      marker.className = index === 0 ? "marker me" : "marker";
      marker.textContent = index === 0 ? "나" : person.displayName[0];
      marker.title = person.displayName;
      const overlay = new window.kakao.maps.CustomOverlay({
        position: new window.kakao.maps.LatLng(
          person.latitude,
          person.longitude,
        ),
        content: marker,
        yAnchor: 1,
      });
      overlay.setMap(mapRef.current);
      return overlay;
    });
  }, [friends, mapReady, user]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = String(
      new FormData(event.currentTarget).get("displayName") ?? "",
    ).trim();
    setSubmitting(true);
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: displayName } },
      });
      if (error) throw error;
      if (!data.user) throw new Error("로그인을 완료하지 못했어요.");

      const { error: profileError } = await supabase.from("profiles").insert({
        id: data.user.id,
        display_name: displayName,
      });
      if (profileError) {
        await supabase.auth.signOut();
        throw profileError;
      }

      localStorage.removeItem("bobchin-token");
      await refresh(data.user.id);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    setSubmitting(true);
    try {
      const { error } = await getSupabase().auth.signOut();
      if (error) throw error;
      setUser(null);
      setFriends([]);
      setSchedules([]);
      setFatalError("");
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const updateLocation = async (sharing: boolean) => {
    if (!user) return;
    setSubmitting(true);
    try {
      if (!sharing) {
        const { error } = await getSupabase().from("locations").upsert({
          user_id: user.id,
          sharing: false,
          latitude: null,
          longitude: null,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
        await refresh(user.id);
        toast("위치 공유를 껐어요.");
        return;
      }

      if (!navigator.geolocation) {
        throw new Error("이 브라우저에서는 위치를 사용할 수 없어요.");
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 8000,
        }),
      );
      const { latitude, longitude } = position.coords;
      const { error } = await getSupabase().from("locations").upsert({
        user_id: user.id,
        sharing: true,
        latitude,
        longitude,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      await refresh(user.id);
      mapRef.current?.setCenter(
        new window.kakao.maps.LatLng(latitude, longitude),
      );
      toast("현재 위치를 업데이트했어요.");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "number"
      ) {
        toast("위치 서비스를 사용하려면 브라우저 위치 권한에 동의해 주세요.");
      } else {
        toast(errorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const shareInvite = async () => {
    if (!user) return;
    const url = `${location.origin}${location.pathname}?invite=${user.inviteCode}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "밥친 친구 초대",
          text: `${user.displayName} 님이 밥친 친구로 초대했어요.`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        toast("초대 링크를 복사했어요.");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast("링크를 복사하지 못했어요.");
      }
    }
  };

  const openScheduleDialog = (schedule: Schedule | null = null) => {
    setEditingSchedule(schedule);
    window.requestAnimationFrame(() => scheduleDialog.current?.showModal());
  };

  const saveSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    const form = new FormData(event.currentTarget);
    const values = {
      user_id: user.id,
      course_name: String(form.get("courseName") ?? "").trim(),
      weekday: Number(form.get("weekday")),
      starts_at: String(form.get("startsAt") ?? ""),
      ends_at: String(form.get("endsAt") ?? ""),
      room: String(form.get("room") ?? "").trim(),
    };
    if (!isFiveMinuteTime(values.starts_at) || !isFiveMinuteTime(values.ends_at)) {
      toast("수업 시작과 종료 시간은 5분 단위로 입력해 주세요.");
      return;
    }
    if (values.ends_at <= values.starts_at) {
      toast("종료 시간은 시작 시간보다 늦어야 해요.");
      return;
    }
    setSubmitting(true);
    try {
      const query = editingSchedule
        ? getSupabase()
            .from("schedules")
            .update(values)
            .eq("id", editingSchedule.id)
            .eq("user_id", user.id)
        : getSupabase().from("schedules").insert(values);
      const { error } = await query;
      if (error) throw error;
      scheduleDialog.current?.close();
      await refresh(user.id);
      toast(editingSchedule ? "시간표를 수정했어요." : "시간표를 저장했어요.");
      setEditingSchedule(null);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSchedule = async (schedule: Schedule) => {
    if (!user || !confirm(`${schedule.courseName} 수업을 삭제할까요?`)) return;
    setSubmitting(true);
    try {
      const { error } = await getSupabase()
        .from("schedules")
        .delete()
        .eq("id", schedule.id)
        .eq("user_id", user.id);
      if (error) throw error;
      await refresh(user.id);
      toast("시간표를 삭제했어요.");
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const updateImportedSchedule = (
    index: number,
    field: keyof ImportedSchedule,
    value: string | number,
  ) => {
    setImportedSchedules((schedules) => schedules.map((schedule, scheduleIndex) => (
      scheduleIndex === index ? { ...schedule, [field]: value } : schedule
    )));
  };

  const importTimetableImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportProgress("시간표를 준비하는 중…");
    try {
      const schedules = await importEverytimeImage(file, setImportProgress);
      setImportedSchedules(schedules);
      window.requestAnimationFrame(() => importDialog.current?.showModal());
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setImporting(false);
      setImportProgress("");
    }
  };

  const saveImportedSchedules = async () => {
    if (!user || !importedSchedules.length) return;
    const invalid = importedSchedules.some((schedule) => (
      !schedule.courseName.trim() ||
      !isFiveMinuteTime(schedule.startsAt) ||
      !isFiveMinuteTime(schedule.endsAt) ||
      schedule.endsAt <= schedule.startsAt
    ));
    if (invalid) {
      toast("모든 수업의 이름과 5분 단위 시간을 확인해 주세요.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await getSupabase().from("schedules").insert(
        importedSchedules.map((schedule) => ({
          user_id: user.id,
          course_name: schedule.courseName.trim().slice(0, 40),
          room: schedule.room.trim().slice(0, 40) || "강의실 미정",
          weekday: schedule.weekday,
          starts_at: schedule.startsAt,
          ends_at: schedule.endsAt,
        })),
      );
      if (error) throw error;
      importDialog.current?.close();
      setImportedSchedules([]);
      await refresh(user.id);
      toast(`${importedSchedules.length}개 수업을 시간표에 추가했어요.`);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const removeFriend = async (friend: Friend) => {
    if (!user || !confirm(`${friend.displayName} 님을 친구에서 삭제할까요?`)) return;
    setSubmitting(true);
    try {
      const { error } = await getSupabase().rpc("remove_friend", {
        p_friend_id: friend.id,
      });
      if (error) throw error;
      await refresh(user.id);
      toast("친구를 삭제했어요.");
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const getMealRecommendation = async () => {
    setRecommending(true);
    try {
      let latitude = user?.latitude ?? CAMPUS.lat;
      let longitude = user?.longitude ?? CAMPUS.lng;
      if (!user?.latitude && navigator.geolocation) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 60_000 }),
          );
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;
        } catch {
          // Location permission is optional; fall back to the campus center.
        }
      }
      const response = await fetch("/api/recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latitude, longitude, preference: foodPreference }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "추천을 만들지 못했어요.");
      setRecommendation(data);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setRecommending(false);
    }
  };

  if (booting) {
    return (
      <main className="login">
        <div className="login-card status-card" role="status">
          <div className="brand"><span>🍚</span>밥친</div>
          <div className="spinner" />
          <h1>밥친을 불러오는 중이에요</h1>
          <p>프로필과 친구 정보를 확인하고 있어요.</p>
        </div>
      </main>
    );
  }

  if (fatalError) {
    return (
      <main className="login">
        <div className="login-card status-card" role="alert">
          <div className="brand"><span>🍚</span>밥친</div>
          <h1>연결에 문제가 생겼어요</h1>
          <p>{fatalError}</p>
          <button className="primary" onClick={() => void bootstrap()}>다시 시도</button>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="login">
        <form className="login-card" onSubmit={login}>
          <div className="brand"><span>🍚</span>밥친</div>
          <h1>이름만 입력하고 시작해요</h1>
          <p>별도 가입이나 학교 인증 없이 이 기기에서 사용할 프로필을 만들어요.</p>
          <label>내 이름<input name="displayName" maxLength={20} required placeholder="예: 김민지" autoComplete="nickname" /></label>
          <button className="primary" disabled={submitting}>{submitting ? "시작하는 중…" : "밥친 시작하기"}</button>
          {pendingInvite ? <div className="invite-note">친구 초대를 받았어요. 로그인하면 자동으로 연결됩니다.</div> : null}
          <div className={`toast ${notice ? "show" : ""}`}>{notice}</div>
        </form>
      </main>
    );
  }

  const kakaoKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

  return (
    <>
      {kakaoKey ? <Script src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoKey}&autoload=false`} strategy="afterInteractive" onReady={initMap} onError={() => setMapError("카카오 지도 SDK를 불러오지 못했어요.")} /> : null}
      <div className="app" aria-busy={refreshing || submitting}>
        <aside>
          <div className="brand"><span>🍚</span>밥친</div>
          <div className="profile"><div className="avatar">{user.displayName[0]}</div><div><b>{user.displayName}</b><small>{user.sharing ? "위치 공유 중" : "위치 공유 꺼짐"}</small></div></div>
          <section>
            <h2>내 친구 <span>{friends.length}</span>명</h2>
            <div className="friend-list">
              {friends.length ? friends.map((friend) => (
                <div className="friend" key={friend.id}>
                  <div className="friend-avatar">{friend.displayName[0]}</div>
                  <div className="friend-copy"><b>{friend.displayName}</b><small>{friend.sharing && friend.latitude != null ? "위치 공유 중" : "위치를 공유하지 않음"}</small></div>
                  <button className="icon-action" aria-label={`${friend.displayName} 친구 삭제`} onClick={() => void removeFriend(friend)}>×</button>
                </div>
              )) : <p className="empty">아직 친구가 없어요.<br />초대 링크를 공유해 보세요.</p>}
            </div>
          </section>
          <div className="side-actions"><button disabled={submitting} onClick={() => void logout()}>로그아웃</button><button className="primary" onClick={() => void shareInvite()}>＋ 초대 링크 공유</button></div>
        </aside>
        <main className="main">
          <header>
            <div><h1>공대에서 누구와 밥 먹을까?</h1><p>{refreshing ? "친구 정보를 업데이트하는 중이에요." : "친구의 현재 위치를 지도에서 확인해 보세요."}</p></div>
            <div className="header-actions"><button aria-label="내 위치 업데이트" disabled={submitting} onClick={() => void updateLocation(true)}>⌖</button><button aria-label="초대 링크 공유" onClick={() => void shareInvite()}>↗</button></div>
          </header>
          <div className="workspace">
            <section className="map-card">
              <div id="map" />
              {!mapReady || mapError || !kakaoKey ? <div className="map-fallback"><div><b>{mapError || !kakaoKey ? "카카오 지도를 표시할 수 없어요" : "카카오 지도를 불러오는 중이에요"}</b><span>{!kakaoKey ? "Kakao JavaScript 키를 환경 변수에 설정해 주세요." : mapError ? "Kakao Developers에서 현재 도메인을 등록해 주세요." : "잠시만 기다려 주세요."}</span></div></div> : null}
              <div className="map-status">{friends.filter((friend) => friend.sharing && friend.latitude != null).length}명의 친구 위치 표시 중</div>
            </section>
            <section className="panel">
              <article className="recommend-card">
                <div className="panel-head"><h2>오늘 뭐 먹지? ✨</h2>{recommendation ? <span className="weather-chip">{recommendation.weather.sky}{recommendation.weather.temperature ? ` · ${recommendation.weather.temperature}°` : ""}</span> : null}</div>
                <p className="recommend-intro">현재 위치와 관악캠퍼스 날씨를 Gemini가 함께 보고 골라드려요.</p>
                <div className="recommend-form"><input aria-label="먹고 싶은 메뉴나 조건" maxLength={200} value={foodPreference} onChange={(event) => setFoodPreference(event.target.value)} placeholder="예: 비건, 든든하게, 가까운 곳" /><button className="primary" disabled={recommending} onClick={() => void getMealRecommendation()}>{recommending ? "고르는 중…" : recommendation ? "다시 추천" : "추천받기"}</button></div>
                {recommendation ? (() => {
                  const selected = recommendation.restaurants.find((restaurant) => restaurant.id === recommendation.recommendation.restaurantId);
                  return selected ? <div className="ai-pick"><small>GEMINI의 PICK</small><h3>{selected.name}</h3><div className="pick-meta"><span>{selected.building}</span><span>약 {selected.distance}m</span></div><p>{recommendation.recommendation.reason}</p><p className="weather-tip">☂ {recommendation.recommendation.weatherTip}</p></div> : null;
                })() : null}
                {recommendation?.weatherError ? <p className="weather-error">기상청 연동 확인 필요: {recommendation.weatherError}</p> : null}
                {recommendation ? <div className="distance-groups">
                  {[{ label: "가까움", min: 0, max: 500 }, { label: "걸어갈 만함", min: 500, max: 1000 }, { label: "멀지만 선택지", min: 1000, max: Infinity }].map((group) => {
                    const items = recommendation.restaurants.filter((restaurant) => restaurant.distance >= group.min && restaurant.distance < group.max);
                    return items.length ? <details key={group.label}><summary>{group.label}<span>{items.length}곳</span></summary>{items.map((restaurant) => <div className="restaurant-row" key={restaurant.id}><div><b>{restaurant.name}</b><small>{restaurant.building} · {restaurant.description}</small></div><strong>{restaurant.distance}m</strong></div>)}</details> : null;
                  })}
                </div> : null}
              </article>
              <article><h2>친구 초대하기</h2><div className="invite-box"><p>링크를 받은 친구가 로그인하면 양쪽 친구 목록에 바로 추가돼요.</p><button onClick={() => void shareInvite()}>초대 링크 복사</button></div></article>
              <article>
                <div className="panel-head">
                  <h2>내 시간표</h2>
                  <div className="panel-head-actions">
                    <button disabled={importing} onClick={() => timetableImageInput.current?.click()}>{importing ? "분석 중…" : "이미지 불러오기"}</button>
                    <button onClick={() => openScheduleDialog()}>추가</button>
                  </div>
                </div>
                {importing ? <p className="import-progress" role="status">{importProgress}</p> : null}
                {schedules.length ? schedules.map((schedule) => (
                  <div className="schedule" key={schedule.id}>
                    <time>{WEEKDAYS[schedule.weekday - 1]}<br />{schedule.startsAt}<br />{schedule.endsAt}</time><div><b>{schedule.courseName}</b><small>{schedule.room || "강의실 미입력"}</small></div>
                    <div className="row-actions"><button aria-label={`${schedule.courseName} 수정`} onClick={() => openScheduleDialog(schedule)}>수정</button><button aria-label={`${schedule.courseName} 삭제`} onClick={() => void deleteSchedule(schedule)}>삭제</button></div>
                  </div>
                )) : <p className="empty">등록된 수업이 없어요.</p>}
              </article>
              <article><h2>실시간 위치 공유</h2><div className="toggle-row"><div><b>{user.sharing ? "공유 중" : "공유 켜기"}</b><small>캠퍼스 안에서만 공유돼요</small></div><button className={`switch ${user.sharing ? "on" : ""}`} aria-label={user.sharing ? "위치 공유 끄기" : "위치 공유 켜기"} disabled={submitting} onClick={() => void updateLocation(!user.sharing)} /></div></article>
            </section>
          </div>
        </main>
      </div>
      <dialog ref={scheduleDialog} onClose={() => setEditingSchedule(null)}>
        <form key={editingSchedule?.id ?? "new"} onSubmit={saveSchedule}>
          <h2>{editingSchedule ? "시간표 수정" : "시간표 추가"}</h2><p>수업 시간과 장소를 저장해요.</p>
          <label>과목명<input name="courseName" maxLength={40} required placeholder="예: 물리학 및 실험" defaultValue={editingSchedule?.courseName} /></label>
          <label>요일<select name="weekday" defaultValue={editingSchedule?.weekday ?? 1}>{WEEKDAYS.map((weekday, index) => <option key={weekday} value={index + 1}>{weekday}요일</option>)}</select></label>
          <label>시작 시간<input name="startsAt" type="time" required defaultValue={editingSchedule?.startsAt} /></label>
          <label>종료 시간<input name="endsAt" type="time" required defaultValue={editingSchedule?.endsAt} /></label>
          <label>강의실<input name="room" maxLength={40} required placeholder="예: 302동 105호" defaultValue={editingSchedule?.room} /></label>
          <div className="dialog-actions"><button type="button" onClick={() => scheduleDialog.current?.close()}>취소</button><button className="primary" disabled={submitting}>{submitting ? "저장 중…" : "저장"}</button></div>
        </form>
      </dialog>
      <input ref={timetableImageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importTimetableImage(event)} />
      <dialog className="import-dialog" ref={importDialog} onClose={() => setImportedSchedules([])}>
        <div className="import-dialog-inner">
          <h2>인식한 시간표 확인</h2>
          <p>에브리타임 이미지의 색상 블록과 텍스트를 읽었어요. 저장 전에 요일·시간·이름을 꼭 확인해 주세요.</p>
          <div className="import-list">
            {importedSchedules.map((schedule, index) => (
              <div className="import-row" key={`${schedule.weekday}-${schedule.startsAt}-${index}`}>
                <select aria-label="요일" value={schedule.weekday} onChange={(event) => updateImportedSchedule(index, "weekday", Number(event.target.value))}>{WEEKDAYS.map((weekday, weekdayIndex) => <option key={weekday} value={weekdayIndex + 1}>{weekday}</option>)}</select>
                <input aria-label="시작 시간" type="time" step="300" value={schedule.startsAt} onChange={(event) => updateImportedSchedule(index, "startsAt", event.target.value)} />
                <input aria-label="종료 시간" type="time" step="300" value={schedule.endsAt} onChange={(event) => updateImportedSchedule(index, "endsAt", event.target.value)} />
                <input aria-label="과목명" maxLength={40} value={schedule.courseName} onChange={(event) => updateImportedSchedule(index, "courseName", event.target.value)} />
                <input aria-label="강의실" maxLength={40} placeholder="강의실" value={schedule.room} onChange={(event) => updateImportedSchedule(index, "room", event.target.value)} />
                <button className="icon-action" aria-label={`${schedule.courseName} 인식 결과 삭제`} onClick={() => setImportedSchedules((schedules) => schedules.filter((_, scheduleIndex) => scheduleIndex !== index))}>×</button>
              </div>
            ))}
          </div>
          <div className="dialog-actions"><button type="button" onClick={() => importDialog.current?.close()}>취소</button><button className="primary" disabled={submitting || !importedSchedules.length} onClick={() => void saveImportedSchedules()}>{submitting ? "저장 중…" : `${importedSchedules.length}개 저장`}</button></div>
        </div>
      </dialog>
      <div className={`toast ${notice ? "show" : ""}`} role="status">{notice}</div>
    </>
  );
}
