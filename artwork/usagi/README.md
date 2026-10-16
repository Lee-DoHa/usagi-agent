# 우사기 그림 원본과 출처

이 폴더의 PNG 네 장은 2026-10-16에 **내장 image_gen 도구**로 제작한 치이카와 우사기 팬 아트다. 공식 제작물이 아니며, 원작 캐릭터의 권리는 © Nagano / chiikawa committee에 있다. 코드의 MIT 라이선스에 포함되지 않는다. 팬 아트를 생성했다는 사실은 권리자의 이용·재배포 허락을 뜻하지 않는다. 기존 저장소의 캐릭터 자산 사용 조건도 함께 확인한다.

외형 참고는 [애니메이션 공식 사이트의 우사기 이미지](https://www.anime-chiikawa.jp/images/img_chara_03.png)다. 공식 원본은 이 폴더나 앱 번들에 복사하지 않았다. 이름표가 붙은 참고 이미지를 그대로 배치하는 대신, 긴 귀 전체가 보이는 투명 전신 그림을 새로 제작했다.

| 파일 | 제작 방식 | 앱에서 사용하는 곳 |
|---|---|---|
| `idle.png` | 공식 이미지를 외형 참고로 생성 | 대기 `eyes_open.png` |
| `closed.png` | idle을 참조하여 눈만 감도록 편집 | 깜빡임 `eyes_closed.png` |
| `study.png` | idle을 참조하여 작은 책을 든 자세 생성 | 집중·작업 `study.png` |
| `active.png` | idle을 참조하여 두 팔을 든 환호 자세 생성 | 알림·춤·응원 포스터와 모션 |

입력·편집 지시 전문은 [prompts.json](prompts.json)에 있다. closed·study·active의 실제 입력 이미지는 이 폴더의 `idle.png`였다. 도구의 결과는 비결정적이므로 같은 프롬프트로 완전히 같은 그림을 얻는다고 보장하지 않는다. 이 폴더 원본으로 앱 자산을 준비하는 과정은 아래와 같다.

```sh
# 저장소 루트, Node.js 24+ 및 ffmpeg(libvpx-vp9) 필요
node desktop/scripts/prepare-usagi.mjs
node desktop/scripts/sync-character-lines.mjs --check
```

준비 스크립트는 PNG를 512 정사각형의 투명 여백 안에 맞추고, 같은 그림을 가볍게 이동하는 4초 VP9 알파 루프 네 개를 만든다. 공식 영상·음성은 사용하지 않는다. 앱에는 `assets/characters/usagi/`만 필요하며 이 원본 폴더는 자산 허용 목록으로 노출되지 않는다.
