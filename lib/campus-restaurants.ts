export type CampusRestaurant = {
  id: string;
  name: string;
  building: string;
  latitude: number;
  longitude: number;
  description: string;
  tags: string[];
};

// Coordinates are building-center approximations for walking-distance guidance.
export const CAMPUS_RESTAURANTS: CampusRestaurant[] = [
  { id: "student", name: "학생회관식당", building: "63동 1층", latitude: 37.4591, longitude: 126.9502, description: "캠퍼스 중심의 대표 학생식당. 수업 사이 빠르게 한 끼 먹기 좋습니다.", tags: ["한식", "가성비", "중앙캠퍼스"] },
  { id: "three", name: "제3식당", building: "75-1동 3층", latitude: 37.4610, longitude: 126.9528, description: "전망대 건물에 있는 생협 식당으로 중앙·윗공대 이동 중 들르기 좋습니다.", tags: ["한식", "전망대", "중앙캠퍼스"] },
  { id: "301", name: "제1공학관식당", building: "301동 지하 1층·1층", latitude: 37.4507, longitude: 126.9520, description: "윗공대 수업 전후 접근성이 좋은 공학관 식당입니다.", tags: ["공대", "한식", "샐러드"] },
  { id: "302", name: "제2공학관식당", building: "302동 1층", latitude: 37.4487, longitude: 126.9527, description: "302동 안에서 이동을 최소화해 식사하기 좋은 공대권 식당입니다.", tags: ["공대", "한식", "빠른식사"] },
  { id: "220", name: "220동 식당", building: "220동 지하 1층", latitude: 37.4642, longitude: 126.9540, description: "생활대·경영대 쪽에 가까우며 돈가스, 덮밥처럼 든든한 선택지가 많은 편입니다.", tags: ["돈가스", "덮밥", "서쪽캠퍼스"] },
  { id: "dongwon", name: "동원관 식당", building: "113동 2층", latitude: 37.4648, longitude: 126.9490, description: "동원생활관의 학생식당. 중앙도서관 북쪽에서 접근하기 편합니다.", tags: ["한식", "중앙캠퍼스"] },
  { id: "jahayeon", name: "자하연식당", building: "109동 2~3층", latitude: 37.4589, longitude: 126.9554, description: "자하연 연못과 농협 인근에 있는 식당으로 조용한 식사를 원할 때 좋은 선택입니다.", tags: ["한식", "교직원식당", "자하연"] },
  { id: "dorm", name: "기숙사식당", building: "919동 1층", latitude: 37.4624, longitude: 126.9586, description: "관악사 생활권의 대표 식당으로 기숙사 근처에서 이동 부담이 적습니다.", tags: ["기숙사", "아침", "한식"] },
];

export function distanceInMeters(from: { latitude: number; longitude: number }, to: CampusRestaurant) {
  const radius = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLon = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return Math.round(radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

