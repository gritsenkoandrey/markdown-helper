# Пример документа

Это тестовый файл для **MD Reader**. Откройте папку `samples`, чтобы проверить дерево и оглавление.

## Форматирование

Обычный текст, *курсив*, **жирный**, ~~зачёркнутый~~ и `инлайн-код`.
Автоссылка: https://tauri.app

> Цитата: просмотрщик должен быть быстрым и не мешать читать.

### Списки

- Пункт один
- Пункт два
  - Вложенный пункт
1. Первый
2. Второй

### Таблица

| Этап | Что делаем | Статус |
|------|------------|--------|
| 1 | Каркас | ✅ |
| 2 | Дерево папок | ✅ |
| 3 | Поиск | ⏳ |

## Код

```ts
function greet(name: string): string {
  return `Привет, ${name}!`;
}
```

## Ссылки

- [Другой документ](notes/second.md)
- [Раздел в другом документе](notes/second.md#детали)
- [Наверх](#пример-документа)

## Длинный раздел

Текст, чтобы было что прокручивать и проверить подсветку текущего раздела в оглавлении.

### Подраздел A

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

### Подраздел B

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

#### Глубокий заголовок

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.
