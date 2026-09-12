"use client";

import Script from "next/script";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

declare global { interface Window { kakao?: any } }

type User = { id: string; displayName: string; inviteCode: string; latitude: number | null; longitude: number | null; sharing: boolean };
type Friend = Omit<User, "inviteCode"> & { lastSeen?: string | null };
type Schedule = { id: string; courseName: string; startsAt: string; room: string };
type MeResponse = { user: User; friends: Friend[]; schedules: Schedule[] };

const CAMPUS = { lat: 37.4564, lng: 126.9515 };

export default function BobchinApp() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [notice, setNotice] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const scheduleDialog = useRef<HTMLDialogElement>(null);

  const toast = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2800); };
  const request = useCallback(async <T,>(path: string, options: RequestInit = {}, authToken = token) => {
    const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했어요.");
    return data as T;
  }, [token]);

  const refresh = useCallback(async (authToken = token) => {
    const data = await request<MeResponse>("/api/me", {}, authToken);
    setUser(data.user); setFriends(data.friends); setSchedules(data.schedules);
  }, [request, token]);

  useEffect(() => {
    const saved = localStorage.getItem("bobchin-token") || "";
    setToken(saved);
    setPendingInvite(new URLSearchParams(location.search).get("invite"));
    if (saved) refresh(saved).catch(() => localStorage.removeItem("bobchin-token"));
  }, [refresh]);

  useEffect(() => {
    if (!user || !pendingInvite) return;
    request<{ friend: Friend }>("/api/invites/accept", { method: "POST", body: JSON.stringify({ code: pendingInvite }) })
      .then(async ({ friend }) => { toast(`${friend.displayName} 님과 친구가 됐어요.`); history.replaceState({}, "", location.pathname); setPendingInvite(null); await refresh(); })
      .catch((error: Error) => toast(error.message));
  }, [pendingInvite, refresh, request, user?.id]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => refresh().catch(() => undefined), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh, user?.id]);

  const initMap = () => {
    if (!window.kakao?.maps) return setMapError(true);
    window.kakao.maps.load(() => {
      mapRef.current = new window.kakao.maps.Map(document.getElementById("map"), { center: new window.kakao.maps.LatLng(CAMPUS.lat, CAMPUS.lng), level: 4 });
      setMapReady(true);
    });
  };

  useEffect(() => {
    if (!mapReady || !window.kakao || !user) return;
    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    const people = [user, ...friends].filter((person) => person.sharing && person.latitude != null && person.longitude != null);
    overlaysRef.current = people.map((person, index) => {
      const marker = document.createElement("div"); marker.className = index === 0 ? "marker me" : "marker"; marker.textContent = index === 0 ? "나" : person.displayName[0]; marker.title = person.displayName;
      const overlay = new window.kakao.maps.CustomOverlay({ position: new window.kakao.maps.LatLng(person.latitude, person.longitude), content: marker, yAnchor: 1 });
      overlay.setMap(mapRef.current); return overlay;
    });
  }, [friends, mapReady, user]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const displayName = String(form.get("displayName") || "").trim();
    try { const data = await request<{ user: User; token: string }>("/api/session", { method: "POST", body: JSON.stringify({ displayName, token: token || undefined }) }, ""); localStorage.setItem("bobchin-token", data.token); setToken(data.token); await refresh(data.token); }
    catch (error) { toast((error as Error).message); }
  };

  const updateLocation = (sharing: boolean) => {
    if (!sharing) return request("/api/location", { method: "POST", body: JSON.stringify({ sharing: false }) }).then(() => refresh()).then(() => toast("위치 공유를 껐어요.")).catch((error: Error) => toast(error.message));
    if (!navigator.geolocation) return toast("이 브라우저에서는 위치를 사용할 수 없어요.");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => { try { await request("/api/location", { method: "POST", body: JSON.stringify({ sharing: true, latitude: coords.latitude, longitude: coords.longitude }) }); await refresh(); mapRef.current?.setCenter(new window.kakao.maps.LatLng(coords.latitude, coords.longitude)); toast("현재 위치를 업데이트했어요."); } catch (error) { toast((error as Error).message); } }, () => alert("위치 서비스를 사용하려면 브라우저 위치 권한에 동의해 주세요."), { enableHighAccuracy: true, timeout: 8000 });
  };

  const shareInvite = async () => {
    if (!user) return; const url = `${location.origin}${location.pathname}?invite=${user.inviteCode}`;
    try { if (navigator.share) await navigator.share({ title: "밥친 친구 초대", text: `${user.displayName} 님이 밥친 친구로 초대했어요.`, url }); else { await navigator.clipboard.writeText(url); toast("초대 링크를 복사했어요."); } } catch (error) { if ((error as Error).name !== "AbortError") toast("링크를 복사하지 못했어요."); }
  };

  const addSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try { await request("/api/schedules", { method: "POST", body: JSON.stringify({ courseName: form.get("courseName"), startsAt: form.get("startsAt"), room: form.get("room") }) }); scheduleDialog.current?.close(); event.currentTarget.reset(); await refresh(); toast("시간표를 저장했어요."); } catch (error) { toast((error as Error).message); }
  };

  if (!user) return <main className="login"><form className="login-card" onSubmit={login}><div className="brand"><span>🍚</span>밥친</div><h1>이름만 입력하고 시작해요</h1><p>별도 가입이나 학교 인증 없이 이 기기에서 사용할 프로필을 만들어요.</p><label>내 이름<input name="displayName" maxLength={20} required placeholder="예: 김민지" autoComplete="nickname" /></label><button className="primary">밥친 시작하기</button>{pendingInvite && <div className="invite-note">친구 초대를 받았어요. 로그인하면 자동으로 연결됩니다.</div>}<div className={`toast ${notice ? "show" : ""}`}>{notice}</div></form></main>;

  return <>
    <Script src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&autoload=false`} strategy="afterInteractive" onLoad={initMap} onError={() => setMapError(true)} />
    <div className="app"><aside><div className="brand"><span>🍚</span>밥친</div><div className="profile"><div className="avatar">{user.displayName[0]}</div><div><b>{user.displayName}</b><small>{user.sharing ? "위치 공유 중" : "위치 공유 꺼짐"}</small></div></div><section><h2>내 친구 <span>{friends.length}</span>명</h2><div className="friend-list">{friends.length ? friends.map((friend) => <div className="friend" key={friend.id}><div className="friend-avatar">{friend.displayName[0]}</div><div><b>{friend.displayName}</b><small>{friend.sharing && friend.latitude ? "위치 공유 중" : "위치를 공유하지 않음"}</small></div></div>) : <p className="empty">아직 친구가 없어요.<br />초대 링크를 공유해 보세요.</p>}</div></section><div className="side-actions"><button onClick={() => { localStorage.removeItem("bobchin-token"); location.reload(); }}>로그아웃</button><button className="primary" onClick={shareInvite}>＋ 초대 링크 공유</button></div></aside>
      <main className="main"><header><div><h1>공대에서 누구와 밥 먹을까?</h1><p>친구의 현재 위치를 지도에서 확인해 보세요.</p></div><div className="header-actions"><button aria-label="내 위치 업데이트" onClick={() => updateLocation(true)}>⌖</button><button aria-label="초대 링크 공유" onClick={shareInvite}>↗</button></div></header><div className="workspace"><section className="map-card"><div id="map" />{(!mapReady || mapError) && <div className="map-fallback"><b>{mapError ? "카카오 지도를 표시할 수 없어요" : "카카오 지도를 불러오는 중이에요"}</b><span>{mapError ? "Kakao Developers에서 현재 도메인을 등록해 주세요." : "잠시만 기다려 주세요."}</span></div>}<div className="map-status">{friends.filter((friend) => friend.sharing && friend.latitude).length}명의 친구 위치 표시 중</div></section><section className="panel"><article><h2>친구 초대하기</h2><div className="invite-box"><p>링크를 받은 친구가 로그인하면 양쪽 친구 목록에 바로 추가돼요.</p><button onClick={shareInvite}>초대 링크 복사</button></div></article><article><div className="panel-head"><h2>오늘의 시간표</h2><button onClick={() => scheduleDialog.current?.showModal()}>추가</button></div>{schedules.length ? schedules.map((schedule) => <div className="schedule" key={schedule.id}><time>{schedule.startsAt}</time><div><b>{schedule.courseName}</b><small>{schedule.room}</small></div></div>) : <p className="empty">등록된 수업이 없어요.</p>}</article><article><h2>실시간 위치 공유</h2><div className="toggle-row"><div><b>{user.sharing ? "공유 중" : "공유 켜기"}</b><small>캠퍼스 안에서만 공유돼요</small></div><button className={`switch ${user.sharing ? "on" : ""}`} aria-label={user.sharing ? "위치 공유 끄기" : "위치 공유 켜기"} onClick={() => updateLocation(!user.sharing)} /></div></article></section></div></main></div>
    <dialog ref={scheduleDialog}><form onSubmit={addSchedule}><h2>시간표 추가</h2><p>수업 시간과 장소를 저장해요.</p><label>과목명<input name="courseName" maxLength={40} required placeholder="예: 물리학 및 실험" /></label><label>시작 시간<input name="startsAt" maxLength={10} required placeholder="예: 13:00" /></label><label>강의실<input name="room" maxLength={40} required placeholder="예: 302동 105호" /></label><div className="dialog-actions"><button type="button" onClick={() => scheduleDialog.current?.close()}>취소</button><button className="primary">저장</button></div></form></dialog><div className={`toast ${notice ? "show" : ""}`}>{notice}</div>
  </>;
}
