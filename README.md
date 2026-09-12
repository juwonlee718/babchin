# 밥친

대학생 친구끼리 캠퍼스에서 위치를 공유하고 같이 식사할 사람을 찾는 서비스입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

`.env.local`에 다음 값을 설정합니다.

```dotenv
DATABASE_URL=postgresql://...
NEXT_PUBLIC_KAKAO_MAP_KEY=...
```

`DATABASE_URL`은 Vercel Marketplace에서 Neon을 연결하면 자동으로 만들 수 있습니다. 로컬에서는 Vercel 환경 변수를 내려받거나 Neon 연결 문자열을 직접 입력합니다.

카카오 지도는 Kakao Developers의 JavaScript 키 설정에서 로컬 개발용 `http://localhost:3000`과 배포할 Vercel 도메인을 웹 플랫폼 도메인으로 등록해야 표시됩니다.

## 구현 기능

- 이름만 입력하는 기기 기반 익명 로그인
- 초대 링크를 통한 양방향 친구 추가
- 카카오 지도와 친구 위치 표시
- 캠퍼스 범위 안에서만 위치 저장
- 15초 주기 친구 위치 갱신
- 개인 시간표 저장

DB 테이블 정의는 `db/schema.sql`에 있습니다. 앱은 첫 API 호출 때 동일한 테이블을 자동 생성합니다.
