<?php
header('Content-Type: application/json');
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$action = $_GET['action'] ?? '';
$uploadDir = __DIR__ . '/../reportes_pdf/';

// Ensure directory exists
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0777, true);
}

switch ($action) {
    case 'save_pdf':
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['pdf_file'])) {
            $file = $_FILES['pdf_file'];
            $filename = $_POST['filename'] ?? 'Reporte_' . date('d-m-Y') . '.pdf';

            // Validate file extension
            $ext = pathinfo($filename, PATHINFO_EXTENSION);
            if (strtolower($ext) !== 'pdf') {
                echo json_encode(["status" => "error", "message" => "Solo se permiten archivos PDF."]);
                exit;
            }

            // Move uploaded file
            $destination = $uploadDir . basename($filename);
            if (move_uploaded_file($file['tmp_name'], $destination)) {
                
                // Keep only the last 10 files
                $files = glob($uploadDir . '*.pdf');
                if (count($files) > 10) {
                    // Sort by modified time, ascending (oldest first)
                    usort($files, function($a, $b) {
                        return filemtime($a) - filemtime($b);
                    });
                    
                    // Delete oldest files until we have 10
                    $filesToDelete = count($files) - 10;
                    for ($i = 0; $i < $filesToDelete; $i++) {
                        unlink($files[$i]);
                    }
                }
                
                echo json_encode(["status" => "success", "message" => "PDF guardado correctamente."]);
            } else {
                echo json_encode(["status" => "error", "message" => "Error al guardar el PDF."]);
            }
        } else {
            echo json_encode(["status" => "error", "message" => "No se recibió el archivo PDF."]);
        }
        break;

    case 'list_pdfs':
        if ($_SERVER['REQUEST_METHOD'] === 'GET') {
            $files = glob($uploadDir . '*.pdf');
            $pdfList = [];
            foreach ($files as $file) {
                $pdfList[] = [
                    'name' => basename($file),
                    'size' => filesize($file),
                    'date' => date('Y-m-d H:i:s', filemtime($file))
                ];
            }
            
            // Sort by modified time, descending (newest first)
            usort($pdfList, function($a, $b) {
                return strtotime($b['date']) - strtotime($a['date']);
            });

            echo json_encode(["status" => "success", "data" => $pdfList]);
        }
        break;

    case 'view_pdf':
        if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['file'])) {
            $filename = basename($_GET['file']);
            $filepath = $uploadDir . $filename;
            
            if (file_exists($filepath)) {
                header('Content-Type: application/pdf');
                header('Content-Disposition: inline; filename="' . $filename . '"');
                header('Content-Length: ' . filesize($filepath));
                readfile($filepath);
                exit;
            } else {
                http_response_code(404);
                echo "Archivo no encontrado.";
            }
        }
        break;

    default:
        echo json_encode(["status" => "error", "message" => "Acción no válida."]);
        break;
}
?>
