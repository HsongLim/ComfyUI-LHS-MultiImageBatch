# ComfyUI LHS Image Nodes

이미지 작업용 ComfyUI 커스텀 노드 모음입니다. 한 번 설치하면 아래 노드가 모두 들어 있습니다.

| 노드 | 메뉴 | 하는 일 |
|---|---|---|
| Multi Image Loader (LHS) | LHS → Multi Image Batch | 여러 장 한 번에 넣고 순서대로 실행, 이미지별 켜기/끄기 |
| Image Picker & Save (LHS) | LHS → Multi Image Batch | 결과를 그리드로 보고 골라서 저장 (png / png16 / jpg / tiff / exr) |
| Image Guide Painter (LHS) | LHS → Image Guide | 이미지 위에 박스·원·펜·화살표·글자로 편집 가이드 그리기 |
| Image Compare (LHS) | LHS → Image Compare | A / B 이름표가 붙은 이미지 비교 (슬라이더, 나란히, 전환, 차이) |

노드 검색 (캔버스 더블클릭) 에서 `LHS` 로 찾을 수 있습니다.

## 1. Multi Image Batch

노드 메뉴의 **LHS → Multi Image Batch** 에 있습니다. (더블클릭 검색: `LHS`)

### Multi Image Loader (LHS)
- **Upload images** 버튼 또는 노드 위로 드래그 & 드롭해서 여러 장을 한 번에 추가
- 썸네일 그리드로 목록 확인, `×` 로 개별 삭제, 클릭하면 크게 보기
- 썸네일 왼쪽 위 **동그라미를 클릭하면 이미지 켜기/끄기** — 꺼진 이미지(OFF)는 목록에 남아 있지만 실행할 때 건너뜁니다. **All on / All off** 로 한 번에 전환
- `folder` 에 폴더 경로를 넣으면 그 폴더의 이미지도 함께 로드 (절대 경로 또는 `ComfyUI/input` 기준 상대 경로)
- `start_index` / `max_images` 로 일부만 테스트
- 출력은 **리스트**라서 뒤에 연결된 노드(KSampler 등)가 이미지마다 한 번씩 순차 실행됩니다
  - 출력: `images`, `masks`, `filenames`, `count`

### Image Picker & Save (LHS)
- 모든 결과를 하나의 그리드로 표시
- **클릭 = 선택/해제**, 🔍 또는 더블클릭 = 크게 보기 (←/→ 이동, Space = 선택, Esc = 닫기)
- `save_all` (기본 켜짐) : 실행할 때마다 결과 전부를 `output` 폴더에 저장. 끄면 미리보기만 하고 골라서 저장
- **💾 Save selected** : 선택한 이미지만 `output` 폴더에 저장
- `project_name` : 저장 폴더 이름 (기본 `MultiImageBatch`). 테스트 주제별로 바꾸면 폴더가 나뉩니다
- `format` : 저장 형식 선택 (선택한 형식의 옵션만 아래에 표시됩니다) — `png` (8-bit) / `png16` (16-bit) / `jpg` / `tiff` (16-bit) / `exr` (half float)
  - `jpg_quality` : jpg 품질 (기본 95)
  - `exr_linear` : exr 저장 시 sRGB → linear 변환 (기본 켜짐, 합성 프로그램용)
  - 워크플로 메타데이터는 png / png16에 저장됩니다
  - 추가 패키지 없이 동작합니다 (png16/tiff/exr 직접 기록, tiff·exr은 무압축)
  - Save selected도 원본 32-bit 데이터에서 저장하므로 16-bit 정밀도가 그대로 유지됩니다
- `labels` 에 Multi Image Loader 의 `filenames` 를 연결하면 각 결과 밑에 원본 파일명이 표시됩니다. 앞쪽 어딘가에 Multi Image Loader 가 있으면 **자동으로 연결**됩니다 (직접 끊으면 다시 연결하지 않음)
- `output_folder` : 저장 폴더. 비워두면 ComfyUI `output` 폴더, `D:\renders\project` 같은 절대 경로도 가능
- `version_folders` (기본 켜짐) : 실행할 때마다 버전 폴더를 새로 만들어 저장

```
<output_folder>/<project_name>/      (기본: MultiImageBatch)
  v001/  001_example_image.png  002_groceries.png ...
  v002/  ...
         selected/   ← save_all이 켜진 상태에서 Save selected로 고른 것
```
  - 파일명은 `labels`(원본 파일명)를 따릅니다. `labels`를 연결하지 않으면 `001.png`, `002.png`
  - `save_all`을 끄면 Save selected로 고른 이미지가 해당 실행의 버전 폴더에 바로 저장됩니다
  - `version_folders`를 끄면 예전처럼 한 폴더에 `project_name_00001_.png` 형식으로 저장됩니다

기본 **Preview Image / Save Image** 노드에 연결해도 모든 결과가 표시·저장됩니다.

### Example

```
Multi Image Loader ─images──▶ (VAE Encode → KSampler → VAE Decode ...) ──▶ Image Picker & Save
                   └filenames──────────────────────────────────────────────▶ (labels)
```


## 2. Image Guide Painter (LHS)

노드 메뉴의 **LHS → Image Guide** 에 있습니다. (더블클릭 검색: `LHS`)

### 이미지 넣기
- **연결**: `image` 입력에 Load Image, Multi Image Loader 등 아무 이미지나 연결
  - Load Image / Multi Image Loader (LHS) 를 바로 연결하면 **실행 전에도** 이미지가 보여서 바로 그릴 수 있습니다
  - 다른 노드를 거쳐 연결한 경우에는 한 번 실행하면 이미지가 보입니다
- **직접 불러오기**: 아무것도 연결하지 않고 **📂 Load image** 버튼으로 이미지 선택

### 그리기
**✏️ Draw guides** 버튼 (또는 썸네일 클릭) 으로 편집 창을 엽니다.

| 도구 | 단축키 | 설명 |
|---|---|---|
| ▭ 박스 | R | 드래그. **Fill** 끄면 테두리만 |
| ◯ 원 | E | 드래그. **Fill** 끄면 테두리만 |
| ✎ 펜 | P | 자유롭게 그리기 |
| ↗ 화살표 | A | 시작점 → 끝점 드래그 |
| T 글자 | T | 클릭 후 입력, Enter = 완료 (Shift+Enter = 줄바꿈) |
| ⌫ 지우개 | X | 지울 도형 클릭 |

- 색상, 투명도(Opacity), 굵기(Size), 글자 크기(Text) 조절
- Ctrl+Z 되돌리기 / Ctrl+Y 다시하기, `[` `]` 굵기 조절
- 여러 장일 때: 아래 썸네일 또는 ← → 로 이미지를 넘기며 각각 그리기 (그린 이미지는 ✓ 표시)
- **Same guides on all images** 를 켜면 모든 이미지에 같은 가이드 적용
- **✔ Save** 로 저장 (Cancel 은 저장하지 않고 닫기)

### 출력
| 출력 | 내용 |
|---|---|
| `org_image` | 원본 이미지 그대로 |
| `guide_image` | 가이드가 그려진 이미지 |
| `mask` | 가이드를 그린 영역 (박스·원은 안쪽 전체) |

여러 장을 넣으면 세 출력 모두 같은 순서의 리스트로 나옵니다. 가이드를 그리지 않은 이미지는 `guide_image` 에도 원본이 그대로 나갑니다.

#### 예시: Qwen Image Edit 에 원본 + 가이드 넣기
```
Multi Image Loader (LHS) ─images────▶ Image Guide Painter (LHS) ─ org_image ───▶ image_1
                         └filenames──▶ (labels)                  └ guide_image ─▶ image_2
```
- `labels` 는 Multi Image Loader 를 연결하면 `filenames` 와 **자동으로 연결**됩니다. 이미지 순서를 바꾸거나 빼도 가이드가 원래 이미지를 따라갑니다. (연결을 직접 끊으면 다시 자동 연결하지 않습니다)
- 프롬프트에서 두 이미지를 구분해 주세요. 예: "첫 번째 이미지를 편집해줘. 두 번째 이미지의 빨간 박스 위치에 'TEST' 글자를 넣고, 표시선은 남기지 마."
- 가이드는 이미지 크기에 대한 비율로 저장되므로, 중간에 해상도가 바뀌어도 위치가 맞습니다.


## 3. Image Compare (LHS)
노드 메뉴 **LHS → Image Compare** 에 있습니다. 두 이미지를 **A(파란색) / B(주황색) 이름표**와 함께 비교합니다.

- `image_a`, `image_b` 연결 후 실행
- 이름표는 자동: 연결된 노드 이름 / Load Image 파일명 / Multi Image Loader 이면 각 이미지 파일명. `label_a`, `label_b` 에 직접 쓸 수도 있음
- 이름표에 해상도도 표시 (크기가 다르면 B에 *scaled to fit* 표시)
- 보기 방식
  | 방식 | 설명 |
  |---|---|
  | Slider | 마우스를 움직이면 경계선 이동. 왼쪽 A, 오른쪽 B |
  | Side by side | 좌우로 나란히 (테두리 색으로 A/B 구분) |
  | Flip A/B | 클릭할 때마다 A ⇄ B 전환, 지금 보이는 쪽을 크게 표시. 미세한 차이 찾기에 좋음 |
  | Difference | 다른 부분만 밝게 표시 (검정 = 같음, 4배 강조) |
- **⇄ Swap** : A/B 자리 바꾸기
- 여러 장 (Multi Image Loader 등 리스트) 이면 한 쌍씩 **‹ ›** 로 넘겨보기. `labels` 에 `filenames` 가 자동 연결됩니다
- **⛶** 또는 이미지 더블클릭 = 전체 화면
  - 휠 확대 · 드래그 이동 · 더블클릭 맞춤 · `1`~`4` 보기 방식 · `←` `→` 다음 쌍 · `Space` A/B 전환 · `S` 바꾸기 · `Esc` 닫기
- 보기 영역은 오른쪽 아래 모서리를 끌어서 높이 조절

## Install

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/HsongLim/ComfyUI-LHS-Nodes.git
```
ComfyUI를 재시작하세요. 추가 패키지 설치는 필요 없습니다.
업데이트: 이 폴더에서 `git pull` 후 재시작.

> 예전에 **ComfyUI-LHS-ImageGuide** 를 따로 설치했다면 그 폴더는 지워주세요. Image Guide Painter 가 이 묶음에 들어왔습니다. (기존 워크플로는 그대로 열립니다)

## Notes
- 리스트 처리 특성상 각 노드가 모든 이미지를 처리한 뒤 다음 노드로 넘어가므로, 결과는 전체 실행이 끝났을 때 한꺼번에 표시됩니다.
- 미리보기 결과는 ComfyUI의 `temp` 폴더에 있어 ComfyUI를 재시작하면 지워집니다. 저장할 이미지는 재시작 전에 **Save selected** 로 저장하세요.
- 업로드한 이미지는 `ComfyUI/input/multi_image_batch/` 에 저장됩니다.
- 이전 버전(출력: image / mask / original)으로 저장한 워크플로를 열면 연결이 새 출력 순서에 맞게 자동으로 옮겨집니다.
- 글자는 Windows의 맑은 고딕 등 시스템 한글 글꼴을 사용합니다.
- **Load image** 로 올린 이미지는 `ComfyUI/input/image_guide/` 에 저장됩니다.

## License
MIT
