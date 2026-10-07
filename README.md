# ComfyUI LHS Multi Image Batch

여러 장의 이미지를 한 번에 넣고 워크플로를 돌리면 이미지마다 순서대로 처리되고,
결과를 한 화면에서 비교해 마음에 드는 것만 골라 저장할 수 있는 ComfyUI 커스텀 노드입니다.

Load many images at once, run your workflow once, and every image is processed in turn.
Review all results in one grid, pick the ones you like and save only those.

## Nodes

노드 메뉴의 **LHS → Multi Image Batch** 에 있습니다. (더블클릭 검색: `LHS`)

### Multi Image Loader (LHS)
- **Upload images** 버튼 또는 노드 위로 드래그 & 드롭해서 여러 장을 한 번에 추가
- 썸네일 그리드로 목록 확인, `×` 로 개별 삭제, 클릭하면 크게 보기
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
- `labels` 에 Multi Image Loader 의 `filenames` 를 연결하면 각 결과 밑에 원본 파일명이 표시됩니다
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

## Example

```
Multi Image Loader ─images──▶ (VAE Encode → KSampler → VAE Decode ...) ──▶ Image Picker & Save
                   └filenames──────────────────────────────────────────────▶ (labels)
```

## Install

### Git
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/HsongLim/ComfyUI-LHS-MultiImageBatch.git
```
ComfyUI를 재시작하세요. 추가 패키지 설치는 필요 없습니다.

### ComfyUI Manager
**Manager → Install via Git URL** 에 `https://github.com/HsongLim/ComfyUI-LHS-MultiImageBatch` 를 붙여넣고 재시작하세요.

## Notes
- 리스트 처리 특성상 각 노드가 모든 이미지를 처리한 뒤 다음 노드로 넘어가므로, 결과는 전체 실행이 끝났을 때 한꺼번에 표시됩니다.
- 미리보기 결과는 ComfyUI의 `temp` 폴더에 있어 ComfyUI를 재시작하면 지워집니다. 저장할 이미지는 재시작 전에 **Save selected** 로 저장하세요.
- 업로드한 이미지는 `ComfyUI/input/multi_image_batch/` 에 저장됩니다.

## License
MIT
