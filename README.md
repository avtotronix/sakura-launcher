<div align="center">

  <img src="logo.png" alt="Sakura Launcher Logo" width="160" />

  # 🌸 Sakura Launcher

  **Быстрый, стильный и современный лаунчер для Minecraft на базе Electron и TypeScript.**

  [![License: MIT](https://img.shields.io/badge/License-MIT-pink.svg?style=for-the-badge)](LICENSE)
  [![Release](https://img.shields.io/badge/Release-v0.2.0-00ff66?style=for-the-badge&logo=github)](https://github.com/avtotronix/sakura-launcher/releases/latest)
  [![Platform](https://img.shields.io/badge/Platform-Windows-blue?style=for-the-badge&logo=windows)](https://github.com/avtotronix/sakura-launcher/releases/latest)

  <br/>

  ### 📥 Скачать для Windows:
  
  [<img src="https://img.shields.io/badge/Скачать-Установщик_(EXE)-2ea44f?style=for-the-badge&logo=windows&logoColor=white" height="38"/>](https://github.com/avtotronix/sakura-launcher/releases/download/v0.2.0/Sakura-Launcher-Installer.exe)
  &nbsp;&nbsp;
  [<img src="https://img.shields.io/badge/Скачать-Portable_Версию-555555?style=for-the-badge&logo=files&logoColor=white" height="38"/>](https://github.com/avtotronix/sakura-launcher/releases/download/v0.2.0/Sakura-Launcher-Portable.exe)

</div>

---

## 📥 Ссылки на загрузку

| Версия | Тип | Размер | Описание | Ссылка |
| :--- | :--- | :--- | :--- | :--- |
| **v0.2.0** | **Installer (Setup)** | ~82 MB | Полный установщик с ярлыками и каталогами | **[Скачать Installer](https://github.com/avtotronix/sakura-launcher/releases/download/v0.2.0/Sakura-Launcher-Installer.exe)** |
| **v0.2.0** | **Portable** | ~82 MB | Запуск без установки (скачал и сразу играй) | **[Скачать Portable](https://github.com/avtotronix/sakura-launcher/releases/download/v0.2.0/Sakura-Launcher-Portable.exe)** |

---

## ✨ Основные особенности

- 🌸 **Эстетичный интерфейс**: Чистый, интуитивный дизайн в стиле Sakura с плавными анимациями.
- 🦀 **Движок Horizon (Rust) 26.3**: Встроенная поддержка ультра-быстрого нативного Rust-клиента для Minecraft 26.3 с колоссальным приростом FPS, поддержкой нативных `.hmod` модов и автоматической адаптацией Java `.jar` модов (Modrinth / CurseForge).
- 🚀 **Все загрузчики Minecraft (включая 26.3 & Java 25)**: Полноценная поддержка **Vanilla**, **Fabric**, **Quilt**, **Forge**, **NeoForge** и **Horizon (Rust)**, изолированные сборки и режим «Чистая игра» без модов.
- 📦 **Единый каталог контента**: Моды, ресурспаки, шейдеры, дополнения и модпаки напрямую из Modrinth и CurseForge.
- 🏷 **Полноценный поиск по категориям**: Удобная боковая панель категорий (Оптимизация, Утилиты, Технологии, Магия, Приключения, Декор и др.) для быстрого нахождения нужных файлов.
- 🛠 **Выбор сборки и создание в 1 клик**: При скачивании любого мода открывается удобное окно выбора целевой сборки либо создания новой сборки с автоматическим предзаполнением версии.
- 🎨 **Система скинов**: Автоматическая установка и отображение скинов игрока в одиночных мирах и сетевой игре.
- 👥 **Друзья онлайн**: Добавление друзей по никнейму и отображение статуса игры в реальном времени.
- 🔑 **Мульти-аккаунты**:
  - **Microsoft** (через официальный OAuth/msmc)
  - **Ely.by** (Yggdrasil auth)
  - **Offline** (локальный режим)
- 🎮 **Discord Rich Presence (RPC)**: Показывает текущий статус и версию игры прямо в профиле Discord.
- 🔒 **Безопасность**: Учетные данные шифруются на уровне ОС с использованием Electron `safeStorage` (DPAPI), полная совместимость с Windows Smart App Control.
- ⚡ **Высокая производительность**: Мгновенная многопоточная проверка и докачка ассетов и библиотек без зависаний.

---

## 🛠 Стек технологий

- **Фреймворк:** [Electron](https://www.electronjs.org/)
- **Язык:** [TypeScript](https://www.typescriptlang.org/)
- **Интеграции:**
  - `minecraft-launcher-core` — ядро запуска и скачивания игровых файлов
  - `msmc` — авторизация Microsoft/Xbox Live
  - `discord-rpc` — интеграция с Discord
  - `electron-builder` — сборка дистрибутивов и установщиков

---

## 🚀 Установка и запуск для разработки

### 1. Клонирование репозитория
```bash
git clone https://github.com/avtotronix/sakura-launcher.git
cd sakura-launcher
```

### 2. Установка зависимостей
```bash
npm install
```

### 3. Запуск в режиме разработки
```bash
npm run dev
```

---

## 📦 Сборка дистрибутивов

- **Сборка инсталлятора Windows (NSIS):**
  ```bash
  npm run dist
  ```

- **Сборка Portable-версии:**
  ```bash
  npm run dist:portable
  ```

---

## 📄 Лицензия

Этот проект распространяется под лицензией **MIT**. Подробности в файле [LICENSE](LICENSE).
