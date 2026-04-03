# Hole

[English](./README.md) | 한국어

`hole`은 단일 공용 도메인 아래에서 로컬 HTTP/TCP 서비스를 외부에 노출할 수 있게 해주는 SSH 기반 터널링 서버입니다. 현재 저장소는 `apps/api`의 NestJS API와 `apps/web`의 Vite + React + TypeScript 프런트엔드를 갖는 pnpm 워크스페이스 모노레포로 구성됩니다.

## 주요 기능

- SSH 연결마다 전용 세션 생성
- Raw TCP 트래픽용 원격 포트 포워딩 지원
- `<random-host>.<DOMAIN>` 형태의 HTTP 요청을 포워딩된 로컬 서비스로 라우팅
- 세션 스냅샷과 요청 이벤트를 SSE로 스트리밍
- 세션, 포워드, 트래픽, 인증, SSE 사용량을 Prometheus metrics로 노출

## 동작 방식

1. 클라이언트가 SSH 서버에 접속합니다.
2. 서버가 세션을 만들고 SSH 셸에 세션 메타데이터를 출력합니다.
3. 클라이언트가 `tcpip-forward` 요청으로 원격 포트 포워딩을 등록합니다.
4. `hole`이 터널 포트와 랜덤 HTTP 서브도메인을 할당합니다.
5. 외부 트래픽이 다음 주소로 유입되어 포워딩된 서비스로 전달됩니다.
   - HTTP: `https://<random-host>.<DOMAIN>`
   - TCP: `<DOMAIN>:<allocated-port>`
6. 세션 변경 사항은 `GET /session/:id/events` SSE 스트림으로 전파됩니다.

## SSH 셸 출력

SSH 셸을 열면 서버가 현재 세션 정보를 아래 형식으로 출력합니다.

```text
sessionId: <session-id>
sessionEvents: https://<DOMAIN>/session/<session-id>/events (SSE)
connectedAt: 2026-03-16T00:00:00.000Z

forwards:
- http: https://<random-host>.<DOMAIN>, tcp: <DOMAIN>:<allocated-port>
```

포워드가 추가되거나 제거되면 이 정보는 자동으로 다시 출력됩니다.

## 엔드포인트

- `GET /metrics`
  - Prometheus metrics 엔드포인트
- `GET /session/:id/events`
  - 세션 스냅샷, HTTP 요청 이벤트, 세션 종료 이벤트를 전달하는 SSE 스트림

## 설정

런타임 설정은 환경 변수로 제어합니다.

```bash
DOMAIN=example.com
FORWARD_TARGET_HOST=127.0.0.1
HTTP_PORT=3000
SSH_HOST=0.0.0.0
SSH_PORT=2222
SSH_HOST_KEY_PATH=./host.key
SSH_AUTH_MODE=noauth
SSH_AUTH_USERNAME=
SSH_AUTH_PASSWORD=
TUNNEL_PORT_RANGE=40000-40100
```

### 환경 변수 설명

- `DOMAIN`: 생성되는 HTTP 터널 호스트에 사용할 기본 도메인
- `FORWARD_TARGET_HOST`: HTTP 트래픽을 포워딩된 포트로 프록시할 때 사용할 내부 대상 호스트
- `HTTP_PORT`: metrics, HTTP 포워딩, 세션 SSE를 제공하는 HTTP 서버 포트
- `SSH_HOST`: SSH 바인딩 주소
- `SSH_PORT`: SSH 바인딩 포트
- `SSH_HOST_KEY_PATH`: SSH 호스트 키 파일 경로. 파일이 없으면 ED25519 키 페어를 자동 생성합니다.
- `SSH_AUTH_MODE`: SSH 인증 모드. `noauth`, `password`를 지원합니다.
- `SSH_AUTH_USERNAME`: `SSH_AUTH_MODE=password`일 때 선택적으로 적용할 사용자명 제한
- `SSH_AUTH_PASSWORD`: `SSH_AUTH_MODE=password`일 때 필수 비밀번호
- `TUNNEL_PORT_RANGE`: `min-max` 형식의 선택적 포트 할당 범위

## 시작하기

### 설치

```bash
pnpm install
```

### 실행

```bash
# 워크스페이스 의존성 설치
pnpm install

# Nest API만 실행
pnpm run dev:api

# Vite 프런트엔드만 실행
pnpm run dev:web

# 두 앱을 함께 실행
pnpm run dev

# 프로덕션 빌드
pnpm run build
pnpm run start:prod
```

### 테스트

```bash
pnpm run test
pnpm run test:e2e
pnpm run test:cov
```

## 워크스페이스 구조

- `apps/api`: NestJS 터널 서버, SSH 처리, metrics, 세션 SSE
- `apps/web`: 운영 UI를 위한 Vite React 프런트엔드

## 컨테이너

- API 이미지 빌드: `docker build -f Dockerfile -t hole-api .`
- Web 이미지 빌드: `docker build -f Dockerfile.web -t hole-web .`

Web 컨테이너는 Nginx로 Vite 빌드 결과를 SPA fallback과 함께 제공합니다. API와 Web 이미지 배포용 GitHub Actions workflow도 분리되어 있습니다.

## 관측성

`hole`은 다음 항목을 추적합니다.

- 활성 세션 수와 세션 생성/종료 누계
- 활성 포워드 수와 포트 할당 실패 수
- SSH 인증 시도
- 포워딩된 TCP 연결 수, 전송 바이트 수, 오류 수
- 포워딩된 HTTP 요청 수와 지연 시간 히스토그램
- 활성 SSE 연결 수와 발행된 SSE 이벤트 수

## Grafana 대시보드

바로 import 가능한 Grafana 대시보드 JSON이 `ops/grafana/dashboards/hole-overview.json`에 포함되어 있습니다.

![Grafana dashboard](./docs/images/grafana-hole-dashboard.png)

## 라이선스

MIT
