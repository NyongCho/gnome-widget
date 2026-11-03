# 날씨 설정과 검증

위젯 설정 → **데이터 → 날씨 지역**에서 도시 이름을 두 글자 이상 입력하고 **검색 → 선택**을 누른다. 지역을 자동 추정하지 않는다. **해제**하면 해당 지역의 데이터와 캐시 연결을 지운다. 검색 실패는 기존 선택과 표시 중인 날씨를 지우지 않는다.

현재 기온·날씨 아이콘과 앞으로 6시간의 기온·강수확률을 표시한다. 없는 값은 `—`이며 0으로 바꾸지 않는다. 시간은 선택한 도시의 시간대로 표시한다. 시스템 시간대가 다른 도시여도 해당 지역의 자정과 DST를 따르도록 Unix timestamp를 받아 UI에서 변환한다. [Open-Meteo 시간 형식 문서](https://open-meteo.com/en/docs#api-documentation).

정상 수집은 15분 간격이다. 네트워크 실패는 30초부터 최대 15분까지 간격을 늘려 재시도하고, HTTP 429는 15분 뒤 재시도한다. 마지막 성공 데이터와 시각을 유지하며 오류 상태를 표시한다. 수동 Refresh는 60초 간격으로 제한한다. 도시 변경은 새 source ID로 즉시 빈 loading 상태가 되고, 이전 도시의 늦은 응답을 버린다.

서비스는 고정 Open-Meteo HTTPS endpoint만 사용하고 응답은 256KiB·요청은 15초로 제한한다. API 키가 필요 없는 무료 개인 비상업용 API를 사용한다. Open-Meteo 데이터는 CC BY 4.0이며 카드와 설정창에 출처를 표시한다. 현재 약관은 일 10000회·시간 5000회·분 600회 미만을 요구한다. [Open-Meteo 약관](https://open-meteo.com/en/terms). 위치 검색은 Open-Meteo geocoding API와 GeoNames 기반 데이터다. [Geocoding 문서](https://open-meteo.com/en/docs/geocoding-api).

선택한 지역은 로컬 설정에 저장하고 해당 좌표를 Open-Meteo에 전송한다. 개인 캘린더 주소는 날씨 요청에 사용하지 않는다. 이 프로젝트에서 현재 실제 사용자 지역은 미설정이다.

## 검증

`./scripts/check.sh`에서 null·0 구분, 자정 경계, Unix timestamp 요청, HTTP 실패/429, backoff, 지연된 도시 A 응답 폐기, B의 빈 loading 상태, 검색 실패 후 선택 유지, stale 성공 시각 보존, 해제를 검사한다. 실제 D-Bus를 통한 검색·선택·Refresh·해제는 격리된 서비스와 응답 fixture로 검증한다.

실제 공개 API는 별도로 실행한다. 테스트는 임시로 서울을 조회하며 사용자 설정에 저장하지 않는다:

```bash
./scripts/dev cargo test --manifest-path daemon/Cargo.toml --test weather live_open_meteo -- --ignored
```

2026-11-04에 실제 geocoding과 현재·6시간 예보 조회가 통과했다. GNOME Devkit 캡처는 정상/오프라인 날씨 fixture, 누락값과 설정 화면을 확인했다. 개인 위치 선택은 사용자가 설정창에서 수행한다.
