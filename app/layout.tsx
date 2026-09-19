import type { Metadata } from "next";
import "./globals.css";
import "./recommendation.css";

export const metadata: Metadata = {
  title: "밥친 · 캠퍼스 메이트",
  description: "캠퍼스에서 같이 밥 먹을 친구를 찾는 위치 기반 서비스",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
