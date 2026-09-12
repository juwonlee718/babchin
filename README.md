# 밥친

대학생 친구끼리 캠퍼스에서 위치를 공유하고 같이 식사할 사람을 찾는 서비스입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

`.env.local`에 다음 값을 설정합니다.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
NEXT_PUBLIC_KAKAO_MAP_KEY=...
```

Supabase Dashboard의 **Authentication > Sign In / Providers**에서 Anonymous Sign-Ins를 활성화한 뒤, **SQL Editor**에서 `supabase/migrations/`의 migration SQL을 실행합니다. 앱은 `@supabase/supabase-js`로 직접 연결하며 `service_role` 키는 사용하지 않습니다.

카카오 지도는 Kakao Developers의 JavaScript 키 설정에서 로컬 개발용 `http://localhost:3000`과 배포할 Vercel 도메인을 웹 플랫폼 도메인으로 등록해야 표시됩니다.

## 구현 기능

- 이름만 입력하는 기기 기반 익명 로그인
- 초대 링크를 통한 양방향 친구 추가
- 카카오 지도와 친구 위치 표시
- 캠퍼스 범위 안에서만 위치 저장
- 15초 주기 친구 위치 갱신
- 개인 시간표 저장
- 개인 시간표 수정·삭제 및 친구 삭제

DB 테이블, 관계, 인덱스, RLS 정책과 친구 관계 RPC는 `supabase/migrations/`에 있습니다. 이 저장소는 Supabase 프로젝트나 DB에 자동으로 연결하거나 migration을 적용하지 않습니다.

## 에브리타임 시간표 이미지 불러오기

시간표의 **이미지 불러오기** 버튼에서 에브리타임 내보내기 PNG/JPG를 선택할 수 있습니다. 브라우저 안에서 색상 수업 블록·한국어 텍스트를 읽어 요일, 시작·종료 시각, 과목명과 강의실을 제안하며, 저장 전 수정할 수 있습니다. 수업 시간은 5분 단위로 저장됩니다.

이 기능을 사용하려면 기존 migration을 실행한 뒤, 새 migration인 `supabase/migrations/20260912062357_add_timetable_session_fields.sql`도 Supabase SQL Editor에서 실행해야 합니다. 이미 등록한 기존 수업은 데이터 보존을 위해 월요일 50분 수업으로 변환되므로 필요하면 앱에서 수정해 주세요.
