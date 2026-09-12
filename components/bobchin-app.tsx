"use client";

import Script from "next/script";
import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { getSupabase } from "@/lib/supabase";

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
  startsAt: string;
  room: string;
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
  starts_at: string;
  room: string;
};

const CAMPUS = { lat: 37.4564, lng: 126.9515 };

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return "요청을 처리하지 못했어요.";
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
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const inviteInFlightRef = useRef("");
  const scheduleDialog = useRef<HTMLDialogElement>(null);

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
            .select("id, course_name, starts_at, room")
            .eq("user_id", userId)
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
          startsAt: schedule.starts_at.slice(0, 5),
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
      starts_at: String(form.get("startsAt") ?? ""),
      room: String(form.get("room") ?? "").trim(),
    };
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
              <article><h2>친구 초대하기</h2><div className="invite-box"><p>링크를 받은 친구가 로그인하면 양쪽 친구 목록에 바로 추가돼요.</p><button onClick={() => void shareInvite()}>초대 링크 복사</button></div></article>
              <article>
                <div className="panel-head"><h2>오늘의 시간표</h2><button onClick={() => openScheduleDialog()}>추가</button></div>
                {schedules.length ? schedules.map((schedule) => (
                  <div className="schedule" key={schedule.id}>
                    <time>{schedule.startsAt}</time><div><b>{schedule.courseName}</b><small>{schedule.room}</small></div>
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
          <label>시작 시간<input name="startsAt" type="time" required defaultValue={editingSchedule?.startsAt} /></label>
          <label>강의실<input name="room" maxLength={40} required placeholder="예: 302동 105호" defaultValue={editingSchedule?.room} /></label>
          <div className="dialog-actions"><button type="button" onClick={() => scheduleDialog.current?.close()}>취소</button><button className="primary" disabled={submitting}>{submitting ? "저장 중…" : "저장"}</button></div>
        </form>
      </dialog>
      <div className={`toast ${notice ? "show" : ""}`} role="status">{notice}</div>
    </>
  );
}
