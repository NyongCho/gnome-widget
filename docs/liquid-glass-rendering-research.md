# Liquid Glass 렌더링 조사

조사일: 2026-11-04. 대상: GNOME Shell 50의 GJS/TypeScript + Cogl GLSL 위젯. 로컬 비교 기준은 `93eb024`이다. 제품 코드는 변경하지 않았으며, 아래 공개 구현은 소스만 검토했다. 이번 조사에서 성능을 측정하지 않았다. Apple의 내부 셰이더 구현을 확인한 자료가 아니므로, 공개 재현 구현의 수식이나 작성자의 설명을 Apple의 실제 알고리즘으로 취급하지 않는다.

현재 구조에서는 **기존 배경 캡처와 Cogl 경로를 유지하고, 별도 blur 캐시·곡면 법선·가장자리 굴절·약한 반사광을 단계적으로 검토하는 방향**이 적합하다. 가독성은 카드 전체를 진하게 덮는 방식 외에 글자 주변의 국소 음영과 배경 밝기 대응을 비교할 가치가 있다. 이것은 아래 소스를 바탕으로 한 제안이며, 적용·시각 검증을 마친 결과는 아니다.

## 사용자 레퍼런스에서 보이는 목표

[제공된 macOS 위젯 이미지](https://preview.redd.it/always-liquid-glass-for-widgets-on-macos-v0-6aq1tytuzl3g1.png?width=700&format=png&auto=webp&s=67843b26ff19f1f55461b42df7b9443bd09c1c55)를 직접 확인했다. 아래는 시각적 관찰이며 렌더링 알고리즘을 역산한 결과가 아니다.

- 위젯 내부가 보라·분홍 배경과 자연스럽게 이어진다. 고정된 흰색/남색 면이 배경을 크게 덮는 인상이 약하다.
- 테두리는 가늘고 방향마다 밝기가 다르다. 강한 무지개 분산이나 넓은 광택 띠는 보이지 않는다.
- 중앙은 잔잔하고 글자·아이콘은 선명하다. 큰 숫자, 굵은 작은 라벨, 밝기 차이가 있는 단색 콘텐츠가 정보의 우선순위를 만든다.
- 원래 배경부터 비교적 완만한 색 변화이므로, 이 이미지 하나로 blur 반경·투명도·IOR·정확한 재질 종류를 정할 수 없다. 밝고 세밀한 배경에서도 같은 가독성이 유지되는지는 별도 문제다.

현재 합성 화면인 [어두운 테마 검증 캡처](../outputs/verification/appearance/widgets-dark-wallpaper.png)와 비교하면, 우리 카드는 짙은 패널 안에 작은 정보가 놓인 인상이 강하다. 따라서 셰이더뿐 아니라 글자 크기·굵기·아이콘 색의 일관성도 함께 비교해야 한다.

## Apple 공식 자료가 설명하는 원칙

**위젯의 표현 방식을 먼저 참고한다.** Apple은 macOS Tahoe와 iOS의 clear/tinted 위젯에서 콘텐츠를 `accented` 모드로 처리하고, 기존 배경을 제거한 뒤 테마에 맞는 유리/색 효과를 넣는다고 설명한다. 글자·아이콘을 포함한 콘텐츠 색 처리도 재질의 일부다. 이는 일반 버튼용 유리 셰이더만 복제해서는 위젯 레퍼런스와 같은 인상을 얻기 어렵다는 근거다. 다만 제공된 스크린샷의 시스템 설정을 확정하는 근거는 아니다. [WWDC25: What's new in widgets, 1:10–3:55](https://developer.apple.com/videos/play/wwdc2025/278/?time=70), [WidgetKit 문서](https://developer.apple.com/documentation/widgetkit/optimizing-your-widget-for-accented-rendering-mode-and-liquid-glass).

**흐림과 밝기 조절이 가독성을 만든다.** HIG에서 regular Liquid Glass는 배경을 흐리고 밝기를 조절하며, clear는 배경을 더 많이 드러내고 필요하면 별도 어둡게 하는 층을 쓴다. 따라서 blur만 키우거나 전체 불투명도만 높이는 방식보다, 배경의 세부 무늬와 밝기 범위를 각각 다루는 쪽이 적합하다. 이는 우리 구현 방향에 대한 추론이며 Apple 내부의 정확한 합성식을 공개한 설명은 아니다. [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials).

**굴절·조명·적응은 함께 작동한다.** Apple의 소개는 렌즈처럼 배경을 휘게 하는 성질, 곡면에 따른 하이라이트, 뒤의 콘텐츠에 맞춘 명암 변화를 설명한다. 공개 발표가 특정 SDF, Snell 구현, 패스 수를 보장하는 것은 아니다. [WWDC25: Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/).

개념을 직접 조절하며 보기에는 원저자의 [Liquid Glass in the Browser](https://kube.io/blog/liquid-glass-css-svg/)가 유용하다. 곡면 높이 → 법선 → 굴절에 따른 이동량 → SVG displacement와 테두리 조명을 시뮬레이션으로 설명한다. 저자도 정면 입사와 한 번의 굴절만 다루는 근사라고 명시한다. 우리에게 필요한 것은 곡면과 이동량의 관계이며, 브라우저 필터 API 자체를 GNOME에 넣는 것은 제안하지 않는다.

## 현재 구현에서 확인한 사실

- [glass.glsl](../extension/shaders/glass.glsl)은 둥근 사각형 SDF, 가장자리에서 강해지는 2차 함수, 2D 방향에 따른 UV 이동을 사용한다. 배경 샘플은 중앙 1회와 대각선 4회이고, 간격은 논리 좌표 기준 1.5px이다. 옅은 청색 혼합과 얇은 방향성 rim이 있지만, 3D 높이장 법선·Snell 계산·Fresnel·색분산·배경 밝기 적응은 없다.
- [glass.ts](../extension/src/effects/glass.ts)는 카드 주변 padding 24를 포함한 RGBA 입력 텍스처 하나를 만들고, dirty일 때만 배경 actor를 다시 그린다. 최종 굴절은 출력 paint에서 실행한다. 텍스처 크기는 `actor.get_resource_scale()`을 사용하며, 크기가 같으면 target을 재사용한다. Snippet 객체도 공유한다. 현재 `textureBytes`는 이 입력 RGBA 버퍼만 센다.
- [background.ts](../extension/src/effects/background.ts)와 [gnome50.ts](../extension/src/platform/gnome50.ts)의 입력은 `BackgroundManager` 배경이다. 다른 창·데스크톱 아이콘을 포함하는 화면 전체 캡처가 아니다. 글자와 버튼은 효과 적용 배경 actor의 형제로 그려져 굴절되지 않는다.
- [card.ts](../extension/src/widgets/card.ts)의 정상 모드 배경 alpha는 어두운 테마 0.68–0.94, 밝은 테마 0.72–0.94이다. 기본 설정값 `opacity=0.24`에서 실제 alpha는 각각 약 74.6%, 77.6%다. 따라서 코드상 유리 이미지가 만들어져도 그 위에 상당히 짙은 버튼 배경이 놓인다. 직전 가독성 수정에서 도입한 이 처리가 유리감 약화에 기여한다는 것은 합성 구조에 근거한 판단이며, 원인별 픽셀 실험은 하지 않았다. 이 최소 alpha는 물리적 제약이 아니라 기존 디자인 선택이므로 다음 재질의 필수 조건으로 고정하지 않는다.

## 비교한 공개 구현

| 구현 / 확인한 커밋 | 채택할 만한 참고점 | 그대로 옮길 수 없는 부분 |
| --- | --- | --- |
| [ryohsuke1231/liquid-glass](https://github.com/ryohsuke1231/liquid-glass/tree/bb9ffae540abdaaa8c156709b35156a0c3bd6220), `bb9ffae` | 같은 GNOME/TypeScript/Cogl 스택, 분리된 blur 캐시와 광학 셰이더, 글자 대비 판정 | 전체 Shell UI를 다루는 stage 캡처와 복잡한 생명주기; 우리 wallpaper 전용 입력에 맞게 범위를 줄여야 함 |
| [ybouane/liquidglass](https://github.com/ybouane/liquidglass/tree/59af227103795f06421a96e2c7d3dceb081decd2), `59af227` | 선명한 배경과 blur 결과 분리, 높이장 법선, 조명 항의 구성 | DOM 캡처/WebGL orchestration, 경험적인 굴절 수식, 많은 blur 패스 |
| [rukkiecodes/liquid-glass](https://github.com/rukkiecodes/liquid-glass/tree/8c718502167099fddc4951a20f72b2aa49a680a3), `8c71850` | 작은 SDF→곡면→굴절 수학 모듈, 평평한 중앙과 곡면 테두리 분리 | SVG 필터 또는 Skia 런타임, 전체 광학 시뮬레이션이 아닌 단일 경계 모델 |
| [4v3ngR/kwin-effects-glass](https://github.com/4v3ngR/kwin-effects-glass/tree/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58), `1edd1cd` | compositor의 다중 해상도 blur, dirty 영역 복사, 국소 tint 강도 | KWin C++/Qt API, GNOME와 다른 화면 캡처·효과 생명주기 |

### 1. GNOME Liquid Glass: 현재 스택과 가장 가까운 참고 구현

[metadata.json](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/metadata.json)은 GNOME 46–51 지원을 선언한다. 이번에는 설치하거나 GNOME 50에서 실행하지 않았으므로, 이 선언을 우리 환경에서 검증된 호환성으로 취급하지 않는다.

**blur 경로.** Cogl texture/FBO를 사용해 저해상도 가로·세로 Gaussian 또는 Dual Kawase down/up을 실행한다. 입력과 설정 키가 일치하면 결과를 재사용한다. Gaussian은 축소 준비 패스 뒤 H/V를 수행하며, Kawase는 단계별 축소·확대를 수행한다. 구조를 직접 참고할 수 있지만 우리 위젯에서의 비용은 측정이 필요하다. [pipelines.ts](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/src/rendering/pipelines.ts#L394-L429), [blur 실행부](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/src/rendering/pipelines.ts#L548-L680).

**곡면과 조명.** superellipse 높이 프로파일에서 기울기와 3D 법선을 만들고 `refract()`의 방향으로 UV를 이동시킨다. 이동량에는 별도 픽셀 강도, 테두리 감쇠와 상한이 있어 완전한 입사·출사 광선 추적은 아니다. 얇은 방향성 rim, Fresnel 유사 항, specular와 안쪽 음영을 분리한다. [glass.frag 곡면](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/shaders/glass.frag#L220-L305), [굴절](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/shaders/glass.frag#L391-L421), [조명](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/shaders/glass.frag#L839-L895).

**글자 대비.** 밝은/어두운 글자 후보의 대비를 비교하고, 반복 전환을 줄이는 평활화와 유지 시간을 둔다. 저해상도 texture를 읽는 경로도 있어 그대로 도입하면 GPU→CPU 읽기 비용을 검토해야 한다. 평균·표본 밝기 판정이 모든 글자 뒤의 대비를 보장하지는 않는다. 우리처럼 정적인 배경을 사용하는 경우 입력 변경 시 판정을 우선 검토할 수 있다. [contrastSampler.ts](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/src/contrastSampler.ts#L145-L224), [글자색 판정](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/src/contrastSampler.ts#L545-L644).

우리에게 우선 참고할 구현이다. 다만 [stage 배경 처리](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/liquid-glass%40thinkingcoding1231.gmail.com/src/rendering/backdropGlass.ts#L417-L440)까지 통째로 바꾸기보다 현재 wallpaper 캐시 위에 필요한 패스만 검토한다. Rust는 데이터 수집 역할을 유지하고, 매 프레임 픽셀 처리는 Cogl/GLSL에 둔다는 기존 구조와 맞는다.

### 2. ybouane: 시각 요소를 분리한 WebGL 구현

**확인한 렌더링 경로.** 카드 주변을 잘라 입력 텍스처에 업로드하고, 배경 FBO에서 blurA로 복사한 뒤 blurA/blurB를 번갈아 사용한다. 각 방향은 9-tap Gaussian이며 가로·세로 쌍을 6번 반복하므로 blur draw는 12회다. 현재 코드의 bg/blurA/blurB는 모두 같은 `w,h`로 할당된다. 주석에 downsample이 있어도 실제 이 경로를 저해상도 blur라고 설명하면 안 된다. [GlassRenderer.ts](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/GlassRenderer.ts#L157-L225), [FBO 할당](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/GlassRenderer.ts#L329-L358), [반복 횟수](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/defaults.ts#L75-L79).

**확인한 표면과 합성.** 둥근 사각형 SDF에서 안쪽 거리 `d`를 얻고 `sqrt(d*(2*zR-d))` 높이 프로파일을 만든다. 높이의 중앙 차분으로 3D 법선을 계산한다. RGB 채널별 UV 이동, 선명한 배경/blur 혼합, `pow(1-abs(N.z),4)`의 Fresnel 유사 항, 여러 고정 광원의 Blinn–Phong, 얇은 stroke와 그림자를 합친다. 중앙은 blur 쪽이며 테두리도 최대 약 15%만 선명한 샘플로 섞인다. [shaders.ts](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/shaders.ts#L121-L285).

**해석의 한계.** 코드 주석은 biconvex/dual-surface refraction이라고 부르지만 실제 이동량은 높이 기울기에 `1-1/ior`와 경험 상수를 곱한 식이다. 입사·출사 경계의 광선을 각각 추적하는 Snell 해법은 아니다. dome 모드도 중심 방향 UV 축소로 확대를 만든다. 밝기·채도·tint는 uniform 기반이며, 밝기 계산은 채도 조절용이다. 글자 대비에 맞춘 자동 scrim은 없다. [굴절과 색 처리](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/shaders.ts#L186-L246).

**성능 구조.** 크기별 FBO를 재사용하고 resize 때 비운다. 별도 orchestration은 유리별 dirty, 위치 변화, 동적 입력, 겹친 이전 유리의 갱신을 검사한다. 이는 유용한 캐시 설계 사례지만, 브라우저의 캔버스 업로드 비용이나 12패스 구성을 GNOME 성능 근거로 사용할 수는 없다. [크기 캐시](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/GlassRenderer.ts#L139-L150), [갱신 판정](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/LiquidGlass.ts#L975-L1080).

### 3. rukkiecodes: 굴절 수학을 읽기 좋은 작은 구현

**확인한 곡면 모델.** 둥근 사각형 SDF의 수치 미분을 구한 뒤, 테두리 폭 안에서 높이가 증가하고 중앙에서는 평평해지는 slab을 구성한다. 프로파일은 원호형 `sqrt(1-(1-t)^2)` 또는 smoothstep이며, 원호형의 가장자리 기울기는 수치적으로 제한한다. `N=normalize(-∂H/∂x,-∂H/∂y,1)`이라는 연결을 코드에서 추적하기 쉽다. [geometry.ts](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/core/geometry.ts), [surface.ts](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/core/surface.ts#L38-L85).

**확인한 굴절.** 정면 입사 `I=(0,0,-1)`와 `eta=1/ior`에 대해 Snell 벡터식을 직접 계산하고 `Δp=T.xy*depth/(-T.z)`로 배경 위치를 구한다. 평평한 중앙은 이동이 0이다. 다만 실제 호출부는 지역 표면 높이 대신 일정한 `depth`를 사용한다. 출구 경계 굴절·반복 내부 반사·장면 깊이는 모델링하지 않는다. 따라서 광학에 근거한 화면 공간 근사로 이해하는 것이 정확하다. [refraction.ts](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/core/refraction.ts#L28-L46), [호출부](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/core/rasterize.ts#L60-L75).

**백엔드 차이.** 웹은 CPU에서 displacement/highlight 이미지를 만들고 SVG의 Gaussian blur→displacement→saturation으로 연결한다. ResizeObserver와 옵션 변경이 재생성을 예약한다. SKSL은 픽셀별 계산으로 RGB의 IOR를 조금씩 달리하여 색분산을 만들지만, 해당 셰이더 자체에는 blur·tint 패스가 없다. 웹의 단일 RG displacement map에는 이 RGB 분산이 없다. 둘의 결과·기능이 완전히 같다는 뜻으로 읽으면 안 된다. [웹 어댑터](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/src/liquid-glass.ts#L110-L216), [SKSL](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/core/sksl.ts#L83-L118).

**조명과 한계.** Blinn–Phong 하이라이트를 `1-N.z²`로 테두리에 집중시킨다. 별도 Fresnel 반사율이나 배경에 적응하는 tint는 없다. CPU 래스터라이저의 설명에 있는 시간 수치는 이 조사에서 검증하지 않았으며 인용하지 않는다. Cogl에는 SVG/Skia를 넣기보다 수학적 구조를 참고해 GLSL로 구성할 가치가 있다. [하이라이트 식](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/core/refraction.ts#L53-L71), [CPU 경로](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/core/rasterize.ts).

### 4. KWin Glass: compositor의 배경 처리와 적응형 tint

**확인한 blur와 갱신.** 배경 사각형 크기의 원본 버퍼와 가로·세로가 단계마다 절반인 FBO들을 확보한다. 바뀐 화면 영역과 배경 사각형의 교집합만 원본으로 복사하고, downsample 체인→upsample 체인→최종 합성으로 진행한다. 크기·형식·단계 수가 같으면 FBO를 다시 만들지 않는다. 다만 입력을 부분 복사한다는 사실이 blur 전체가 부분 갱신된다는 뜻은 아니다. [blur.cpp](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/blur.cpp#L1280-L1330), [blur 패스](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/blur.cpp#L1443-L1498).

각 축을 따로 도는 Gaussian 대신, 각 해상도에서 주변의 가중 샘플을 더하는 down/up 방식이다. 현재 downsample·upsample 코드는 각각 중앙을 포함해 9개 샘플을 사용한다. upsample에는 어두운 픽셀에서 채도 보정을 줄이는 선택 기능도 있다. 이 구조가 동일 품질에서 더 빠른지는 GNOME에서 측정해야 한다. [downsample.glsl](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/shaders/downsample.glsl), [upsample.glsl](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/shaders/upsample.glsl).

**확인한 굴절과 해석의 한계.** 선택 가능한 Snell 경로는 SDF 수치 기울기로 법선을 만들고 GLSL `refract()`를 호출한다. 그러나 결과의 xy를 정규화하여 방향만 쓰고, 이동 크기는 별도 테두리 프로파일·강도·lensShift로 정한다. RGB도 IOR별 광선을 계산하기보다 이동 크기를 달리한다. 이는 Snell 방향과 예술적 이동량을 섞은 모델이며, 완전한 물리 굴절이나 파장별 재료 모델은 아니다. [snells-glass.glsl](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/shaders/snells-glass.glsl#L7-L74).

**확인한 적응형 tint와 rim.** 배경의 가중 RGB 밝기와 tint의 밝기 차이로 픽셀별 tint 강도를 조절하는 `adjustedTintStrength()`가 있다. 이는 텍스트 대비를 직접 계산하는 알고리즘은 아니다. rim은 위치·거리 프로파일과 선택적인 Oklab 배경색 혼합으로 만든다. `rimSpecular`라는 이름이 있어도 법선/광원 기반 Fresnel·Blinn–Phong 계산과 동일하지 않다. [glass.glsl](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/shaders/glass.glsl#L83-L129), [rim.glsl](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/shaders/rim.glsl#L24-L90).

## 라이선스 확인 범위

| 구현 | 실제 확인한 표기 | 재사용 판단에 남은 사항 |
| --- | --- | --- |
| GNOME Liquid Glass | [MIT 전문과 저작권 고지](https://github.com/ryohsuke1231/liquid-glass/blob/bb9ffae540abdaaa8c156709b35156a0c3bd6220/LICENSE) | 실제 코드를 가져올 경우 해당 고지와 출처를 보존한다. 이번에는 읽기만 했다. |
| ybouane | [package.json의 MIT](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/package.json#L35), [README의 MIT](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/README.md#L240-L242) | 검사한 커밋 트리에는 별도 LICENSE 전문 파일이 없었다. 코드 복사 전 저작권 고지와 실제 배포 조건을 확인해야 한다. |
| rukkiecodes | [package.json의 MIT](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/package.json#L7), [README의 MIT 및 저자](https://github.com/rukkiecodes/liquid-glass/blob/8c718502167099fddc4951a20f72b2aa49a680a3/README.md#L83-L85) | 검사한 커밋 트리에는 별도 LICENSE 전문 파일이 없었다. 동일하게 고지 확인이 남는다. |
| KWin Glass | [루트 LICENSE의 GPLv3 전문](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/LICENSE), [blur.cpp의 GPL-2.0-or-later SPDX](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/blur.cpp#L1-L7) | 저장소 전체를 단순히 MIT나 단일 SPDX로 요약하지 않는다. 실제 가져올 파일의 고지와 출처를 확인해야 한다. |

이번에는 외부 코드를 제품에 복사하지 않았다. 위 내용은 저장소에서 관찰한 라이선스 표기이며 배포 적합성 검토를 완료했다는 뜻은 아니다.

## 이 프로젝트에 제안하는 렌더링 순서

다음은 **미구현 제안**이다. Cogl의 현재 offscreen capture와 글자 분리 구조를 유지한다.

1. **배경 입력 캐시.** 현재 카드 주변 wallpaper texture를 유지한다. padding은 굴절의 최대 픽셀 이동량과 blur kernel의 전체 지지 범위, AA/그림자 여유를 함께 고려한다. 현재 24px을 무조건 그대로 사용하면 강한 굴절이나 넓은 blur에서 clamp 자국이 생길 수 있다.
2. **별도 blur 캐시.** 첫 실험은 이해하기 쉬운 분리형 가로/세로 Gaussian 두 패스로 한다. 더 넓은 blur가 필요하면 절반 해상도 또는 down/up 체인을 비교한다. 원본과 blur를 별도 texture로 보관하고 입력·크기·blur 파라미터가 바뀔 때만 재생성한다. 굴절 강도·rim·글자 변화는 blur 재계산 사유에서 분리한다.
3. **SDF와 bevel 법선.** 기존 둥근 사각형을 유지하되 테두리 폭과 높이를 별도 변수로 둔다. 중앙은 평평하게 하고, 곡면 프로파일에서 3D 법선을 만든다. 원호형과 smoothstep형을 같은 조건에서 비교한다. SDF 기울기가 0에 가까운 위치의 정규화와 가장자리 무한 기울기에는 작은 수치 guard가 필요하다.
4. **굴절 배경 샘플.** `refract(I,N,1/ior)`에 따른 방향과 명시적인 slab 깊이로 픽셀 이동을 만들고 UV로 바꾼다. 이동 최대값을 제한한다. 선명한 원본과 blur 결과의 혼합을 테두리 거리로 조절한다. rukkie 방식의 일정 depth와 실제 높이 기반 이동량은 다른 모양을 낼 수 있으므로 동등한 물리 모델이라고 부르지 않는다.
5. **반사광과 마감.** 같은 법선을 사용한 약한 Fresnel 근사와 한 방향의 좁은 specular부터 시작한다. rim 폭·명암과 배경의 색을 먼저 조정하고 색분산은 기본 0 또는 미세한 값으로 제한한다. RGB 분산을 넣으면 최종 패스의 샘플 수가 늘며, 텍스트에는 적용하지 않는다.
6. **가독성 합성.** 카드 전체 alpha를 낮추면서 배경 밝기 범위 조절과 제목·시각·수치 뒤의 부드러운 scrim을 비교한다. scrim이 글자마다 얼룩처럼 보이지 않도록 충분히 완만하게 한다. 흰 배경은 아무리 흐려도 흰색이므로 blur만으로 흰 글자의 가독성을 해결할 수는 없다. 배경에 맞는 밝은/어두운 단색 콘텐츠와 필요한 국소 보정을 함께 검토한다. KWin의 자동 tint나 표본 밝기 판정은 텍스트 대비 보장으로 대체하지 않는다. 저전력·실패 시 기존 진한 배경을 유지한다.
7. **최종 출력과 캐시 수명.** 현재의 premultiplied RGBA 출력을 유지한다. WebGL/Skia 예제의 alpha·좌표·색공간을 그대로 붙이지 않는다. logical px와 실제 texture px를 구분하고, resize·resource scale·배경 갱신·disable 때 모든 추가 target의 수명과 진단 메모리를 함께 관리한다.

이 제안은 GLSL의 통상적인 굴절 정의와 비교한 것이다. `I`와 `N`은 정규화되어 있어야 한다. [Khronos refract 정의](https://registry.khronos.org/OpenGL-Refpages/gl4/html/refract.xhtml).

또한 예제 코드를 옮길 때 `smoothstep` 인자 순서를 확인해야 한다. ybouane의 `smoothstep(maxD*0.35,0,inside)` 및 KWin rim 일부처럼 첫 경계가 두 번째보다 큰 호출이 있다. Khronos 정의에서는 `edge0 >= edge1` 결과가 미정의이므로, 이식 실험에서는 `1-smoothstep(low,high,x)`처럼 정상 순서로 표현한다. [ybouane 해당 줄](https://github.com/ybouane/liquidglass/blob/59af227103795f06421a96e2c7d3dceb081decd2/src/shaders.ts#L164-L166), [KWin 해당 줄](https://github.com/4v3ngR/kwin-effects-glass/blob/1edd1cdb382dacf0c8b9cb4bd28011c8de95eb58/src/shaders/rim.glsl#L76-L84), [Khronos 원문](https://github.com/KhronosGroup/OpenGL-Refpages/blob/main/gl4/smoothstep.xml#L82-L96).

## 작게 검증할 시각 프로토타입

우선 한 개 카드, 한 장의 동일한 배경, 동일한 글자와 크기를 사용한 GNOME/Cogl 비교가 필요하다. **첫 시각 검증은 충분한 blur와 낮춘 전체 tint, 단색 콘텐츠의 조합**으로 한다. 굴절 수식의 고도화보다 레퍼런스의 잔잔한 중앙과 가독성을 먼저 확인한다. HTML 데모가 보기 좋다는 사실만으로 GNOME 출력이나 비용을 판단하지 않는다.

| 비교 | 확인하려는 질문 |
| --- | --- |
| 현재 카드 ↔ 전체 tint를 낮추고 글자 부분에 scrim을 둔 카드 | 굴절을 바꾸기 전에 유리감 손실의 주원인이 전체 불투명도인지 |
| 현재 5-sample ↔ 별도 H/V blur | 중앙 배경이 부드럽게 정리되고 테두리 변형은 읽히는지 |
| 현재 UV 변형 ↔ 원호형/smoothstep형 법선과 단일 경계 굴절 | 실제 모서리에서 굴절 폭·연속성·방향이 더 자연스러운지 |
| rim만 ↔ 약한 Fresnel/specular 추가 | 흰 테두리 장식이나 플라스틱처럼 보이지 않고 두께가 읽히는지 |
| 색분산 0 ↔ 아주 약한 분산 | 고대비 테두리에서 이득이 있는지, 무지개 테두리로 과장되는지 |

검증 배경은 검정·흰색·밝은 사진·어두운 사진·세밀한 격자와 강한 수직/수평선을 포함한다. 100%와 실제 fractional scaling에서 모서리, padding 경계, 글자 선명도를 비교한다. 굴절 강도 0에서도 blur/가독성이 유지되는지, 평평한 중앙이 불필요하게 확대되지 않는지 확인한다.

성능 확인은 정지 상태, 위젯 데이터만 갱신, 배경 변경, 이동/크기 변경을 구분한다. 입력/blur/output paint 횟수, 추가 RGBA target 용량, 실제 프레임 시간을 기록한다. target 용량은 대략 `Σ(pixelWidth*pixelHeight*4)`이며 GPU 전체 메모리가 아니다. 동일한 시각 품질에서 측정하기 전에는 다중 패스가 더 빠르다거나 정해진 FPS를 보장한다고 말하지 않는다. 이러한 실험은 아직 수행하지 않았다.
