# Video to 3D point cloud with COLMAP

This folder prepares a video as an image sequence for COLMAP, a structure-from-motion and multi-view-stereo tool. The machine has an NVIDIA GeForce RTX 5060 Laptop GPU with 8 GB VRAM. Portable FFmpeg 9 and COLMAP 4.2.1 CUDA binaries are kept in the local `tools` folder and are ignored by Git.

## Requirements

- Windows 10/11
- FFmpeg on `PATH`
- COLMAP installed separately (current Windows builds are available from the official COLMAP releases)

The preparation script uses the portable FFmpeg under `tools` automatically. No system-wide installation or PATH change is needed. COLMAP can be run from `tools\colmap\bin\colmap.exe`.

## Prepare a video

From the repository root, run:

```powershell
.\simpy\prepare_video.ps1 -VideoPath "C:\path\to\capture.mp4"
```

By default the script samples 2 frames per second, limits the longest image dimension to 2560 pixels, and writes JPGs to `simpy\output\images`. Adjust the sampling rate for the camera motion and scene detail. Start with a short clip; keep consecutive frames that overlap substantially, and avoid motion blur, moving subjects, and abrupt cuts.

Optional arguments:

```powershell
.\simpy\prepare_video.ps1 -VideoPath "C:\path\to\capture.mp4" -FramesPerSecond 1 -MaxDimension 0 -OutputDirectory "D:\colmap\capture"
```

To prepare just a segment, use `-StartSeconds` and `-DurationSeconds`.

Set `MaxDimension 0` to preserve source dimensions. COLMAP expects the images in a folder; use the resulting `images` directory as its input. For a basic GUI run, open COLMAP, create a new project, select the output directory, and run **Feature extraction**, **Feature matching**, **Mapper**, and then **Dense reconstruction**. GPU acceleration is selected in COLMAP's feature and matching options when supported by its build. Export the dense cloud as PLY from the reconstruction viewer.

## Existing reconstruction

`output\IMG_5819_conference_sparse.ply` is a sparse point cloud from the conference-room portion of `IMG_5819.MOV`. The sparse model registered 7 views and contains 155 points. Dense stereo did not complete on this driver/GPU build, so this is a sparse preview rather than a dense room scan. For a more complete result, record a shorter clip of one room with clear camera translation, strong overlap, and visible texture; avoid long pans and people moving through the scene.

## Capture tips

- Move the camera around a mostly static subject, with overlap between adjacent views.
- Include parallax by changing viewpoint; panning in place gives weak depth.
- Use steady, well-lit footage and lock focus/exposure if possible.
- A single video can reconstruct only surfaces visible from its viewpoints; it does not recover hidden geometry.

The script does not install software or alter the source video.
