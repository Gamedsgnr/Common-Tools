# Gemini CLI Guidelines for Project Interaction

This document outlines the conventions and guidelines for the Gemini CLI agent when interacting with this project's codebase. Adherence to these rules ensures consistency, maintainability, and quality across all modifications and additions.

## 1. Code Conventions

When modifying or adding code, the agent **MUST** rigorously adhere to existing project conventions. This includes:
*   **Analyzing surrounding code:** Understand the local context, formatting, naming, and architectural patterns.
*   **Mimicking style:** Match the existing formatting, naming conventions (variables, functions, classes), type usage, and overall structure.
*   **Idiomatic changes:** Ensure all changes integrate naturally and idiomatically with the surrounding code.
*   **Comments:** Add comments sparingly, focusing on *why* something is done for complex logic, rather than *what* is done. Do not edit comments separate from the code being changed.

## 2. Library and Framework Usage

The agent **MUST NOT** assume the availability or appropriateness of any library or framework. Before using any external resource:
*   **Verify established usage:** Check existing imports, configuration files (e.g., `package.json`, `requirements.txt`), or observe neighboring files to confirm a library's established presence.
*   **Prioritize existing solutions:** If an existing library or framework already handles a required task within the project, prefer using it over introducing new dependencies.

## 3. Style Guidelines (UI/Frontend)

For any frontend or UI-related tasks, the agent **MUST** prioritize consistency and project-specific styling.
*   **Reference `style_palette.html`:** For default styles of buttons, borders, input fields, typography, and other common UI elements, the agent **MUST** refer to `style_palette.html` located in the root directory. This file serves as the primary source of truth for the project's visual language.
*   **Extend existing styles:** When new UI components are required, first attempt to compose them using existing classes and patterns defined or implied by `style_palette.html` and other project files.
*   **Dark Theme Consistency:** Maintain the established dark theme across all new or modified UI components.

## 5. Language

*   **Communication Language:** All responses and communications with the user **MUST** be in Russian (Русский).

## 4. General Principles

*   **Proactiveness:** Fulfill user requests thoroughly, including adding tests where appropriate.
*   **Confirm Ambiguity:** Always confirm with the user before taking significant actions outside the clear scope of the request or for ambiguous instructions.
*   **No Reversion:** Do not revert changes unless explicitly instructed by the user or due to an identified error in an agent-made change.
*   **Security:** Always apply security best practices. Never introduce code that exposes sensitive information.
*   **Efficiency:** Prefer efficient solutions and minimize verbose output from tools.

# Кодовые стандарты и правила редактирования

1. **Нормализация строк**: Проект использует окончания строк `LF`. Всегда генерируй код с `LF`, а не `CRLF`.
2. **Отступы**: В проекте используются 4 пробела для отступов в HTML/JS. Никогда не используй табы.
3. **Правило поиска и замены (Search-and-Replace)**:
   - Перед каждым изменением файла ОБЯЗАТЕЛЬНО используй `read_file`, чтобы увидеть текущие отступы и невидимые символы.
   - Для `old_string` выбирай минимально необходимый, но уникальный фрагмент кода. Не бери огромные блоки, если можно заменить одну строку.
   - Игнорируй лишние пустые строки в конце файлов.
4. **Точность контекста**: Если ты не уверен в количестве пробелов перед строкой, прочитай файл заново. Ошибка "0 occurrences found" недопустима.
