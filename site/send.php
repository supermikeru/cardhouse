<?php
declare(strict_types=1);

// Не выводить ошибки/предупреждения PHP в ответ — иначе они попадут перед
// JSON и сломают разбор ответа на клиенте.
ini_set('display_errors', '0');
ob_start();

require __DIR__ . '/telegram-config.php';

$isAjax = isset($_SERVER['HTTP_X_REQUESTED_WITH'])
    && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest';

function respond(bool $ok, string $message, int $code, bool $isAjax): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    if ($isAjax) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['ok' => $ok, 'message' => $message], JSON_UNESCAPED_UNICODE);
        exit;
    }
    $target = $ok ? 'index.html?sent=1#contact' : 'index.html?sent=0#contact';
    header('Location: ' . $target, true, 303);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(false, 'Метод не поддерживается', 405, $isAjax);
}

// Honeypot: настоящие посетители никогда не заполняют это поле.
if (!empty($_POST['website'])) {
    respond(true, 'Заявка отправлена', 200, $isAjax);
}

$name = trim((string)($_POST['name'] ?? ''));
$contact = trim((string)($_POST['contact'] ?? ''));
$message = trim((string)($_POST['message'] ?? ''));

if ($name === '' || $contact === '') {
    respond(false, 'Заполните имя и контакт', 422, $isAjax);
}
if (mb_strlen($name) > 200 || mb_strlen($contact) > 200 || mb_strlen($message) > 2000) {
    respond(false, 'Слишком длинное значение', 422, $isAjax);
}

function tgEscape(string $text): string
{
    return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $text);
}

function sendTelegramMessage(string $token, $chatId, string $text): bool
{
    $url = "https://api.telegram.org/bot{$token}/sendMessage";
    $payload = http_build_query([
        'chat_id' => $chatId,
        'text' => $text,
        'parse_mode' => 'HTML',
    ]);

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $result = curl_exec($ch);
    } else {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
                'content' => $payload,
                'timeout' => 10,
            ],
        ]);
        $result = @file_get_contents($url, false, $context);
    }

    if ($result === false) {
        return false;
    }
    $decoded = json_decode((string)$result, true);
    return !empty($decoded['ok']);
}

$lines = [
    '<b>Новая заявка — Карточный Дом</b>',
    '',
    '<b>Имя:</b> ' . tgEscape($name),
    '<b>Контакт:</b> ' . tgEscape($contact),
];
if ($message !== '') {
    $lines[] = '<b>Комментарий:</b> ' . tgEscape($message);
}
$text = implode("\n", $lines);

$deliveredToAny = false;
foreach (TELEGRAM_CHAT_IDS as $chatId) {
    if (sendTelegramMessage(TELEGRAM_BOT_TOKEN, $chatId, $text)) {
        $deliveredToAny = true;
    }
}

if (!$deliveredToAny) {
    respond(false, 'Не удалось отправить заявку. Попробуйте позже или напишите нам в Telegram.', 502, $isAjax);
}

respond(true, 'Заявка отправлена', 200, $isAjax);
