# FreeVideo + Qwen-Image 2.1 в едином SwarmUI (RTX 5080)

Проекты **FreeVideo** (генерация видео и звука MiniMax H3 / VDN) и **Qwen-Image 2.1** (фотореалистичная генерация изображений) объединены в одной директории:
📁 **`C:\Users\daler\Desktop\FreeVideo`**

Вся старая папка `C:\Users\daler\Desktop\Qwen Image` удалена.

---

## 🔒 Изоляция кэша и файлов (100% внутри папки проекта)

Все загрузки, кэши и временные файлы принудительно перенаправлены строго внутрь проекта:
- **Кэш Hugging Face:** `C:\Users\daler\Desktop\FreeVideo\cache\huggingface`
- **Кэш PyTorch:** `C:\Users\daler\Desktop\FreeVideo\cache\torch`
- **Кэш Triton:** `C:\Users\daler\Desktop\FreeVideo\cache\triton`
- **Кэш ModelScope:** `C:\Users\daler\Desktop\FreeVideo\cache\modelscope`
- **Кэш pip / uv:** `C:\Users\daler\Desktop\FreeVideo\cache\pip`
- **Временные файлы (TEMP/TMP):** `C:\Users\daler\Desktop\FreeVideo\tmp`
- **Результаты генерации (Output):** `C:\Users\daler\Desktop\FreeVideo\output` и `SwarmUI\Output`
- **Модели:** `C:\Users\daler\Desktop\FreeVideo\models` и `SwarmUI\dlbackend\comfy\ComfyUI\models`

Никакие файлы не попадают на диск D: или в системные папки пользователя.

---

## 🚀 Запуск через SwarmUI (Удобный веб-интерфейс)

Запустите одним кликом:
👉 **`Start_SwarmUI.bat`** (в папке `FreeVideo` или ярлык **`Start_FreeVideo_SwarmUI.bat`** на Рабочем столе).

1. Откроется окно консоли, которое запустит SwarmUI и фоновый движок ComfyUI с поддержкой RTX 5080.
2. В браузере автоматически откроется интерфейс по адресу: **`http://localhost:7801`**.

---

## 🎬 Генерация видео через FreeVideo в SwarmUI

1. В верхней панели SwarmUI откройте вкладку **`Comfy Workflow`**.
2. В списке справа выберите **`FreeVideo-All-in-One`**.
3. Заполните удобные поля ввода (без возни с лапшой нод):
   - **Prompt**: текстовое описание сцены, движений, звуков и музыки.
   - **Width / Height**: разрешение (по умолчанию `1344 x 768`).
   - **Duration (s)**: длительность видео в секундах (по умолчанию 5-10 сек).
   - **Seed**: зерно генерации (или случайное).
   - **Two-pass acceleration**: включено по умолчанию для ускоренной генерации в 2 прохода.
4. Нажмите **Queue Prompt** (кнопку запуска генерации).
5. Видео сгенерируется со встроенным звуковым сопровождением!

---

## 🎨 Генерация картинок через Qwen-Image 2.1 в SwarmUI

1. В той же вкладке **`Comfy Workflow`** выберите **`Qwen_Image_2_1_GGUF`**.
2. Введите промпт и нажмите **Queue Prompt**.
3. Либо используйте стандартную вкладку **`Generate`** в SwarmUI.

---

## 🛠 Прямой запуск ComfyUI (при необходимости)

Если когда-либо потребуется открыть классический граф нод ComfyUI или встроенный таймлайн-редактор FreeVideo (`/freevideo/`):
👉 Запустите **`Start_ComfyUI_Directly.bat`** (откроется на `http://127.0.0.1:8188`).
