<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bingo Elite - Admin Dashboard</title>
    <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/luxon@3.3.0"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            /* Professional Color Palette */
            --primary: #3a56d4;
            --primary-dark: #2f46b8;
            --primary-light: #5a72e0;
            --secondary: #6d28d9;
            --accent: #0ea5e9;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
            --info: #06b6d4;
            --agent: #8b5cf6;
            
            /* Neutral Colors */
            --dark-1: #0f172a;
            --dark-2: #1e293b;
            --dark-3: #334155;
            --dark-4: #475569;
            --light-1: #f8fafc;
            --light-2: #e2e8f0;
            --light-3: #cbd5e1;
            
            /* UI Colors */
            --bg-primary: var(--dark-1);
            --bg-secondary: var(--dark-2);
            --bg-card: var(--dark-2);
            --border-color: var(--dark-3);
            --text-primary: var(--light-1);
            --text-secondary: var(--light-3);
            --text-muted: var(--light-3);
            
            /* Sizing */
            --sidebar-width: 280px;
            --header-height: 70px;
            --border-radius: 12px;
            --border-radius-sm: 8px;
            --border-radius-lg: 16px;
            --spacing-xs: 4px;
            --spacing-sm: 8px;
            --spacing-md: 16px;
            --spacing-lg: 24px;
            --spacing-xl: 32px;
            --spacing-2xl: 48px;
            
            /* Typography */
            --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            --font-size-xs: 0.75rem;
            --font-size-sm: 0.875rem;
            --font-size-base: 1rem;
            --font-size-lg: 1.125rem;
            --font-size-xl: 1.25rem;
            --font-size-2xl: 1.5rem;
            --font-size-3xl: 1.875rem;
            --font-weight-normal: 400;
            --font-weight-medium: 500;
            --font-weight-semibold: 600;
            --font-weight-bold: 700;
            
            /* Shadows */
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            
            /* Transitions */
            --transition-fast: 150ms ease;
            --transition-normal: 250ms ease;
            --transition-slow: 350ms ease;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--font-family);
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5;
            font-size: var(--font-size-base);
            font-weight: var(--font-weight-normal);
            overflow-x: hidden;
        }

        /* Login Screen */
        .login-screen {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100vh;
            background: linear-gradient(135deg, var(--dark-1) 0%, #0c1424 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        }

        .login-container {
            width: 100%;
            max-width: 440px;
            padding: var(--spacing-lg);
        }

        .login-card {
            background: var(--bg-card);
            border-radius: var(--border-radius-lg);
            padding: var(--spacing-2xl) var(--spacing-xl);
            border: 1px solid var(--border-color);
            box-shadow: var(--shadow-xl);
            backdrop-filter: blur(20px);
            animation: slideUp 0.6s ease-out;
        }

        .login-header {
            text-align: center;
            margin-bottom: var(--spacing-2xl);
        }

        .login-logo {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--spacing-sm);
            margin-bottom: var(--spacing-md);
        }

        .login-logo-icon {
            width: 48px;
            height: 48px;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            color: white;
        }

        .login-logo-text {
            font-size: var(--font-size-2xl);
            font-weight: var(--font-weight-bold);
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .login-subtitle {
            color: var(--text-secondary);
            font-size: var(--font-size-sm);
            margin-top: var(--spacing-xs);
        }

        .form-group {
            margin-bottom: var(--spacing-lg);
        }

        .form-label {
            display: block;
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
            margin-bottom: var(--spacing-sm);
        }

        .input-with-icon {
            position: relative;
        }

        .input-icon {
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            z-index: 1;
        }

        .form-input {
            width: 100%;
            padding: 14px 16px 14px 48px;
            background: var(--dark-3);
            border: 2px solid var(--border-color);
            border-radius: var(--border-radius);
            color: var(--text-primary);
            font-size: var(--font-size-base);
            font-family: var(--font-family);
            transition: all var(--transition-normal);
        }

        .form-input:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(58, 86, 212, 0.2);
            background: var(--dark-2);
        }

        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 14px 24px;
            border-radius: var(--border-radius);
            font-size: var(--font-size-base);
            font-weight: var(--font-weight-semibold);
            font-family: var(--font-family);
            cursor: pointer;
            border: none;
            transition: all var(--transition-normal);
            text-decoration: none;
        }

        .btn-primary {
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }

        .btn-block {
            width: 100%;
        }

        .login-footer {
            margin-top: var(--spacing-xl);
            text-align: center;
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        /* Dashboard */
        .dashboard {
            display: none;
            min-height: 100vh;
        }

        .dashboard-container {
            display: flex;
            min-height: 100vh;
        }

        /* Sidebar */
        .sidebar {
            width: var(--sidebar-width);
            background: var(--bg-card);
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            z-index: 100;
            transition: transform var(--transition-normal);
        }

        .sidebar-header {
            padding: var(--spacing-xl);
            border-bottom: 1px solid var(--border-color);
        }

        .sidebar-logo {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
        }

        .sidebar-logo-icon {
            width: 40px;
            height: 40px;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
            color: white;
        }

        .sidebar-logo-text {
            font-size: var(--font-size-lg);
            font-weight: var(--font-weight-bold);
            color: var(--text-primary);
        }

        .sidebar-version {
            font-size: var(--font-size-xs);
            color: var(--text-secondary);
            margin-top: 2px;
        }

        .sidebar-nav {
            flex: 1;
            padding: var(--spacing-lg) 0;
            overflow-y: auto;
        }

        .nav-section {
            margin-bottom: var(--spacing-lg);
        }

        .nav-section-title {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            padding: 0 var(--spacing-xl) var(--spacing-sm);
            margin-bottom: var(--spacing-sm);
        }

        .nav-item {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            padding: 12px var(--spacing-xl);
            color: var(--text-secondary);
            text-decoration: none;
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            transition: all var(--transition-fast);
            position: relative;
            margin: 2px 0;
            cursor: pointer;
        }

        .nav-item:hover {
            color: var(--text-primary);
            background: rgba(255, 255, 255, 0.05);
        }

        .nav-item.active {
            color: var(--primary);
            background: rgba(58, 86, 212, 0.1);
            border-right: 3px solid var(--primary);
        }

        .nav-item i {
            font-size: 1.125rem;
            width: 24px;
            text-align: center;
        }

        .nav-badge {
            margin-left: auto;
            background: var(--danger);
            color: white;
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            padding: 2px 8px;
            border-radius: 20px;
            min-width: 24px;
            text-align: center;
        }

        .sidebar-footer {
            padding: var(--spacing-lg) var(--spacing-xl);
            border-top: 1px solid var(--border-color);
            background: rgba(0, 0, 0, 0.2);
        }

        .connection-status {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            margin-bottom: var(--spacing-sm);
        }

        .status-indicator {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--success);
            animation: pulse 2s infinite;
        }

        .status-text {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        .last-update {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
            margin-top: var(--spacing-xs);
        }

        /* Main Content */
        .main-content {
            flex: 1;
            margin-left: var(--sidebar-width);
            min-height: 100vh;
            background: var(--bg-primary);
        }

        /* Header */
        .header {
            height: var(--header-height);
            background: var(--bg-card);
            border-bottom: 1px solid var(--border-color);
            padding: 0 var(--spacing-xl);
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 50;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: var(--spacing-lg);
        }

        .page-title {
            font-size: var(--font-size-xl);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .page-subtitle {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
        }

        .btn-icon {
            width: 40px;
            height: 40px;
            border-radius: var(--border-radius);
            background: var(--dark-3);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all var(--transition-fast);
        }

        .btn-icon:hover {
            background: var(--dark-4);
            color: var(--text-primary);
            border-color: var(--primary-light);
        }

        .user-menu {
            display: flex;
            align-items: center;
            gap: var(--spacing-sm);
            padding: var(--spacing-sm);
            background: var(--dark-3);
            border-radius: var(--border-radius);
        }

        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: linear-gradient(45deg, var(--primary), var(--secondary));
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: var(--font-weight-semibold);
        }

        /* Content Sections */
        .content-section {
            display: none;
            padding: var(--spacing-xl);
        }

        .content-section.active {
            display: block;
            animation: fadeIn 0.3s ease;
        }

        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: var(--spacing-lg);
            margin-bottom: var(--spacing-xl);
        }

        .stat-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius-lg);
            padding: var(--spacing-lg);
            transition: all var(--transition-normal);
        }

        .stat-card:hover {
            transform: translateY(-4px);
            border-color: var(--primary-light);
            box-shadow: var(--shadow-lg);
        }

        .stat-header {
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-md);
        }

        .stat-icon {
            width: 56px;
            height: 56px;
            border-radius: var(--border-radius);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            background: rgba(58, 86, 212, 0.1);
            color: var(--primary);
        }

        .stat-icon.users { background: rgba(58, 86, 212, 0.1); color: var(--primary); }
        .stat-icon.online { background: rgba(16, 185, 129, 0.1); color: var(--success); }
        .stat-icon.games { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
        .stat-icon.balance { background: rgba(109, 40, 217, 0.1); color: var(--secondary); }
        .stat-icon.agents { background: rgba(139, 92, 246, 0.1); color: var(--agent); }

        .stat-title {
            flex: 1;
        }

        .stat-title h3 {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }

        .stat-value {
            font-size: var(--font-size-3xl);
            font-weight: var(--font-weight-bold);
            color: var(--text-primary);
            line-height: 1;
        }

        .stat-change {
            display: flex;
            align-items: center;
            gap: var(--spacing-xs);
            font-size: var(--font-size-sm);
            margin-top: var(--spacing-sm);
        }

        .stat-change.positive {
            color: var(--success);
        }

        .stat-change.negative {
            color: var(--danger);
        }

        /* Tables */
        .table-container {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius-lg);
            overflow: hidden;
        }

        .table-header {
            padding: var(--spacing-lg) var(--spacing-xl);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: var(--spacing-md);
        }

        .table-title {
            font-size: var(--font-size-lg);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .table-controls {
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
            flex-wrap: wrap;
        }

        .table {
            width: 100%;
            border-collapse: collapse;
        }

        .table thead th {
            padding: var(--spacing-md) var(--spacing-xl);
            text-align: left;
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            background: var(--dark-3);
            border-bottom: 1px solid var(--border-color);
        }

        .table tbody td {
            padding: var(--spacing-lg) var(--spacing-xl);
            border-bottom: 1px solid var(--border-color);
            font-size: var(--font-size-sm);
        }

        .table tbody tr:hover {
            background: rgba(255, 255, 255, 0.02);
        }

        /* Forms */
        .form-row {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: var(--spacing-lg);
            margin-bottom: var(--spacing-lg);
        }

        .form-actions {
            display: flex;
            gap: var(--spacing-md);
            justify-content: flex-end;
            margin-top: var(--spacing-xl);
            padding-top: var(--spacing-lg);
            border-top: 1px solid var(--border-color);
        }

        /* Modals */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            opacity: 0;
            visibility: hidden;
            transition: all var(--transition-normal);
        }

        .modal-overlay.active {
            opacity: 1;
            visibility: visible;
        }

        .modal {
            background: var(--bg-card);
            border-radius: var(--border-radius-lg);
            width: 90%;
            max-width: 500px;
            max-height: 90vh;
            overflow-y: auto;
            border: 1px solid var(--border-color);
            box-shadow: var(--shadow-xl);
            transform: translateY(20px);
            transition: transform var(--transition-normal);
        }

        .modal-overlay.active .modal {
            transform: translateY(0);
        }

        .modal-header {
            padding: var(--spacing-xl);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .modal-title {
            font-size: var(--font-size-lg);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
        }

        .modal-close {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: 8px;
            border-radius: var(--border-radius);
            transition: all var(--transition-fast);
        }

        .modal-close:hover {
            background: var(--dark-3);
            color: var(--text-primary);
        }

        .modal-body {
            padding: var(--spacing-xl);
        }

        .modal-footer {
            padding: var(--spacing-xl);
            border-top: 1px solid var(--border-color);
            display: flex;
            gap: var(--spacing-md);
            justify-content: flex-end;
        }

        /* Cards */
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius-lg);
            padding: var(--spacing-lg);
        }

        .card-header {
            margin-bottom: var(--spacing-lg);
        }

        .card-title {
            font-size: var(--font-size-lg);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: var(--spacing-xs);
        }

        .card-subtitle {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        /* Tabs */
        .tabs {
            display: flex;
            gap: var(--spacing-sm);
            border-bottom: 1px solid var(--border-color);
            margin-bottom: var(--spacing-lg);
        }

        .tab {
            padding: var(--spacing-md) var(--spacing-lg);
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-medium);
            cursor: pointer;
            position: relative;
            transition: all var(--transition-fast);
        }

        .tab:hover {
            color: var(--text-primary);
        }

        .tab.active {
            color: var(--primary);
        }

        .tab.active::after {
            content: '';
            position: absolute;
            bottom: -1px;
            left: 0;
            right: 0;
            height: 2px;
            background: var(--primary);
        }

        /* Toast Notifications */
        .toast-container {
            position: fixed;
            top: var(--spacing-xl);
            right: var(--spacing-xl);
            z-index: 1000;
            display: flex;
            flex-direction: column;
            gap: var(--spacing-sm);
        }

        .toast {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius);
            padding: var(--spacing-md) var(--spacing-lg);
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
            max-width: 400px;
            box-shadow: var(--shadow-lg);
            transform: translateX(100%);
            opacity: 0;
            transition: all var(--transition-normal);
        }

        .toast.show {
            transform: translateX(0);
            opacity: 1;
        }

        .toast-icon {
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
        }

        .toast.success .toast-icon {
            background: rgba(16, 185, 129, 0.1);
            color: var(--success);
        }

        .toast.error .toast-icon {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }

        .toast-content {
            flex: 1;
        }

        .toast-title {
            font-size: var(--font-size-sm);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: 2px;
        }

        .toast-message {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        /* Filters */
        .filters {
            display: flex;
            gap: var(--spacing-md);
            margin-bottom: var(--spacing-lg);
            flex-wrap: wrap;
        }

        .filter-group {
            display: flex;
            flex-direction: column;
            gap: var(--spacing-xs);
        }

        .filter-label {
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-medium);
            color: var(--text-secondary);
        }

        .select {
            padding: 10px 12px;
            background: var(--dark-3);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius);
            color: var(--text-primary);
            font-size: var(--font-size-sm);
            font-family: var(--font-family);
            min-width: 160px;
            cursor: pointer;
            transition: all var(--transition-fast);
        }

        .select:focus {
            outline: none;
            border-color: var(--primary);
        }

        /* Badges */
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
        }

        .badge-success {
            background: rgba(16, 185, 129, 0.1);
            color: var(--success);
        }

        .badge-warning {
            background: rgba(245, 158, 11, 0.1);
            color: var(--warning);
        }

        .badge-danger {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }

        .badge-info {
            background: rgba(6, 182, 212, 0.1);
            color: var(--info);
        }

        .badge-primary {
            background: rgba(58, 86, 212, 0.1);
            color: var(--primary);
        }

        .badge-agent {
            background: rgba(139, 92, 246, 0.1);
            color: var(--agent);
        }

        /* Action Buttons */
        .action-buttons {
            display: flex;
            gap: var(--spacing-sm);
        }

        .btn-sm {
            padding: 8px 16px;
            font-size: var(--font-size-sm);
        }

        .btn-success {
            background: var(--success);
            color: white;
        }

        .btn-warning {
            background: var(--warning);
            color: white;
        }

        .btn-danger {
            background: var(--danger);
            color: white;
        }

        .btn-info {
            background: var(--info);
            color: white;
        }

        .btn-agent {
            background: var(--agent);
            color: white;
        }

        /* Charts */
        .chart-container {
            height: 300px;
            position: relative;
        }

        .chart-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius-lg);
            padding: var(--spacing-lg);
        }

        /* Quick Actions */
        .quick-actions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: var(--spacing-lg);
            margin-bottom: var(--spacing-xl);
        }

        .quick-action-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--border-radius-lg);
            padding: var(--spacing-lg);
            text-align: center;
            cursor: pointer;
            transition: all var(--transition-normal);
        }

        .quick-action-card:hover {
            transform: translateY(-4px);
            border-color: var(--primary);
            box-shadow: var(--shadow-lg);
        }

        .quick-action-icon {
            width: 56px;
            height: 56px;
            border-radius: var(--border-radius);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            margin: 0 auto var(--spacing-md);
            background: rgba(58, 86, 212, 0.1);
            color: var(--primary);
        }

        .quick-action-title {
            font-size: var(--font-size-base);
            font-weight: var(--font-weight-semibold);
            color: var(--text-primary);
            margin-bottom: var(--spacing-xs);
        }

        .quick-action-desc {
            font-size: var(--font-size-sm);
            color: var(--text-secondary);
        }

        /* Enhanced User Row Styles */
        .user-row {
            transition: all var(--transition-fast);
            border-left: 4px solid transparent;
        }
        
        .user-row:hover {
            border-left-color: var(--primary);
            background: rgba(58, 86, 212, 0.05);
        }
        
        .user-row.online {
            border-left-color: var(--success);
        }
        
        .user-row.offline {
            border-left-color: var(--text-muted);
        }
        
        .user-row.playing {
            border-left-color: var(--warning);
        }
        
        /* Enhanced Action Buttons */
        .action-buttons {
            display: flex;
            gap: var(--spacing-sm);
            flex-wrap: wrap;
        }
        
        .btn-action {
            padding: 6px 12px;
            border-radius: var(--border-radius-sm);
            font-size: var(--font-size-xs);
            font-weight: var(--font-weight-semibold);
            cursor: pointer;
            border: none;
            transition: all var(--transition-fast);
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        
        .btn-action.add-funds {
            background: rgba(16, 185, 129, 0.2);
            color: var(--success);
            border: 1px solid rgba(16, 185, 129, 0.3);
        }
        
        .btn-action.add-funds:hover {
            background: var(--success);
            color: white;
        }
        
        .btn-action.deposit {
            background: rgba(59, 130, 246, 0.2);
            color: var(--primary-light);
            border: 1px solid rgba(59, 130, 246, 0.3);
        }
        
        .btn-action.deposit:hover {
            background: var(--primary);
            color: white;
        }
        
        .btn-action.withdraw {
            background: rgba(239, 68, 68, 0.2);
            color: var(--danger);
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        
        .btn-action.withdraw:hover {
            background: var(--danger);
            color: white;
        }

        /* Responsive Design */
        @media (max-width: 1200px) {
            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (max-width: 992px) {
            .sidebar {
                transform: translateX(-100%);
            }
            
            .sidebar.active {
                transform: translateX(0);
            }
            
            .main-content {
                margin-left: 0;
            }
            
            .header {
                padding: 0 var(--spacing-lg);
            }
            
            .content-section {
                padding: var(--spacing-lg);
            }
        }

        @media (max-width: 768px) {
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .table-header {
                flex-direction: column;
                gap: var(--spacing-md);
                align-items: stretch;
            }
            
            .table-controls {
                flex-wrap: wrap;
            }
            
            .filters {
                flex-direction: column;
            }
            
            .select {
                min-width: 100%;
            }
            
            .action-buttons {
                flex-wrap: wrap;
            }
        }

        /* Animations */
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes pulse {
            0%, 100% {
                opacity: 1;
                transform: scale(1);
            }
            50% {
                opacity: 0.5;
                transform: scale(1.1);
            }
        }

        /* Loading States */
        .loading {
            opacity: 0.6;
            pointer-events: none;
        }

        .loading-spinner {
            width: 24px;
            height: 24px;
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-top-color: var(--primary);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }

        /* Utility Classes */
        .text-muted {
            color: var(--text-muted);
        }

        .text-success {
            color: var(--success);
        }

        .text-danger {
            color: var(--danger);
        }

        .text-warning {
            color: var(--warning);
        }

        .text-primary {
            color: var(--primary);
        }

        .mb-1 { margin-bottom: var(--spacing-xs); }
        .mb-2 { margin-bottom: var(--spacing-sm); }
        .mb-3 { margin-bottom: var(--spacing-md); }
        .mb-4 { margin-bottom: var(--spacing-lg); }
        .mb-5 { margin-bottom: var(--spacing-xl); }

        .mt-1 { margin-top: var(--spacing-xs); }
        .mt-2 { margin-top: var(--spacing-sm); }
        .mt-3 { margin-top: var(--spacing-md); }
        .mt-4 { margin-top: var(--spacing-lg); }
        .mt-5 { margin-top: var(--spacing-xl); }

        .d-flex { display: flex; }
        .align-center { align-items: center; }
        .justify-between { justify-content: space-between; }
        .gap-1 { gap: var(--spacing-xs); }
        .gap-2 { gap: var(--spacing-sm); }
        .gap-3 { gap: var(--spacing-md); }
        .gap-4 { gap: var(--spacing-lg); }
        .gap-5 { gap: var(--spacing-xl); }

        .w-100 { width: 100%; }
        .h-100 { height: 100%; }
        
        /* Transaction History Styles */
        .transaction-history {
            background: var(--bg-card);
            border-radius: var(--border-radius-lg);
            border: 1px solid var(--border-color);
            overflow: hidden;
        }
        
        .transaction-item {
            padding: var(--spacing-md) var(--spacing-lg);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            gap: var(--spacing-md);
            transition: all var(--transition-fast);
        }
        
        .transaction-item:hover {
            background: rgba(255, 255, 255, 0.02);
        }
        
        .transaction-item:last-child {
            border-bottom: none;
        }
        
        .transaction-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1rem;
        }
        
        .transaction-icon.deposit {
            background: rgba(16, 185, 129, 0.1);
            color: var(--success);
        }
        
        .transaction-icon.withdraw {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }
        
        .transaction-icon.commission {
            background: rgba(139, 92, 246, 0.1);
            color: var(--agent);
        }
        
        .transaction-details {
            flex: 1;
        }
        
        .transaction-title {
            font-weight: var(--font-weight-semibold);
            margin-bottom: 2px;
        }
        
        .transaction-time {
            font-size: var(--font-size-xs);
            color: var(--text-muted);
        }
        
        .transaction-amount {
            font-weight: var(--font-weight-bold);
            font-size: var(--font-size-base);
        }
        
        .transaction-amount.deposit {
            color: var(--success);
        }
        
        .transaction-amount.withdraw {
            color: var(--danger);
        }
        
        .transaction-amount.commission {
            color: var(--agent);
        }
        
        /* Connection icon styles */
        .connection-icon {
            margin-right: 8px;
            font-size: 1rem;
        }
        
        .connection-icon.connected {
            color: var(--success);
        }
        
        .connection-icon.disconnected {
            color: var(--danger);
        }
    </style>
</head>
<body>
    <!-- Login Screen -->
    <div id="loginScreen" class="login-screen">
        <div class="login-container">
            <div class="login-card">
                <div class="login-header">
                    <div class="login-logo">
                        <div class="login-logo-icon">
                            <i class="fas fa-shield-alt"></i>
                        </div>
                        <div class="login-logo-text">Bingo Elite</div>
                    </div>
                    <p class="login-subtitle">Admin Dashboard v4.2</p>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Admin Password</label>
                    <div class="input-with-icon">
                        <i class="fas fa-key input-icon"></i>
                        <input type="password" id="adminPassword" class="form-input" placeholder="Enter your password" autocomplete="off" value="admin1234">
                    </div>
                </div>
                
                <button class="btn btn-primary btn-block" onclick="adminLogin()">
                    <i class="fas fa-sign-in-alt"></i>
                    Access Dashboard
                </button>
                
                <div style="margin-top: 15px; text-align: center;">
                    <button class="btn btn-sm" onclick="testServerConnection()" 
                            style="background: var(--dark-3); color: var(--text-secondary); padding: 8px 16px;">
                        <i class="fas fa-network-wired"></i> Test Connection
                    </button>
                </div>
                
                <div class="login-footer">
                    <p class="text-muted">
                        <i class="fas fa-info-circle"></i>
                        Default password: admin1234
                    </p>
                    <p class="text-muted mt-2">
                        Change the password in server.js for production use
                    </p>
                    <p class="text-muted mt-2" style="font-size: 0.75rem;">
                        <i class="fas fa-exclamation-triangle"></i>
                        Make sure the game server is running before logging in
                    </p>
                </div>
            </div>
        </div>
    </div>

    <!-- Main Dashboard -->
    <div id="dashboard" class="dashboard">
        <div class="dashboard-container">
            <!-- Sidebar -->
            <div class="sidebar" id="sidebar">
                <div class="sidebar-header">
                    <div class="sidebar-logo">
                        <div class="sidebar-logo-icon">
                            <i class="fas fa-crown"></i>
                        </div>
                        <div>
                            <div class="sidebar-logo-text">Bingo Elite</div>
                            <div class="sidebar-version">Admin v4.2</div>
                        </div>
                    </div>
                </div>
                
                <div class="sidebar-nav">
                    <div class="nav-section">
                        <div class="nav-section-title">Main</div>
                        <div class="nav-item active" data-section="overview">
                            <i class="fas fa-tachometer-alt"></i>
                            <span>Dashboard</span>
                        </div>
                    </div>
                    
                    <div class="nav-section">
                        <div class="nav-section-title">Management</div>
                        <div class="nav-item" data-section="users">
                            <i class="fas fa-users"></i>
                            <span>User Management</span>
                            <span id="userCountBadge" class="nav-badge">0</span>
                        </div>
                        <div class="nav-item" data-section="agents">
                            <i class="fas fa-user-tie"></i>
                            <span>Agent Management</span>
                            <span id="agentCountBadge" class="nav-badge">0</span>
                        </div>
                        <div class="nav-item" data-section="rooms">
                            <i class="fas fa-gamepad"></i>
                            <span>Game Rooms</span>
                        </div>
                    </div>
                    
                    <div class="nav-section">
                        <div class="nav-section-title">Transactions</div>
                        <div class="nav-item" data-section="transactions">
                            <i class="fas fa-exchange-alt"></i>
                            <span>All Transactions</span>
                        </div>
                        <div class="nav-item" data-section="wallet-approvals">
                            <i class="fas fa-wallet"></i>
                            <span>Wallet Approvals</span>
                            <span id="walletApprovalBadge" class="nav-badge">0</span>
                        </div>
                        <div class="nav-item" data-section="deposit-requests">
                            <i class="fas fa-money-bill-wave"></i>
                            <span>Deposit Requests</span>
                            <span id="depositRequestBadge" class="nav-badge">0</span>
                        </div>
                        <div class="nav-item" data-section="withdrawal-requests">
                            <i class="fas fa-money-check-alt"></i>
                            <span>Withdrawal Requests</span>
                            <span id="withdrawalRequestBadge" class="nav-badge">0</span>
                        </div>
                    </div>
                    
                    <div class="nav-section">
                        <div class="nav-section-title">Analytics</div>
                        <div class="nav-item" data-section="analytics">
                            <i class="fas fa-chart-line"></i>
                            <span>Analytics</span>
                        </div>
                        <div class="nav-item" data-section="logs">
                            <i class="fas fa-clipboard-list"></i>
                            <span>Activity Log</span>
                        </div>
                    </div>
                    
                    <div class="nav-section">
                        <div class="nav-section-title">System</div>
                        <div class="nav-item" data-section="controls">
                            <i class="fas fa-sliders-h"></i>
                            <span>System Controls</span>
                        </div>
                        <div class="nav-item" data-section="debug">
                            <i class="fas fa-bug"></i>
                            <span>Debug</span>
                        </div>
                    </div>
                </div>
                
                <div class="sidebar-footer">
                    <div class="connection-status">
                        <div class="status-indicator"></div>
                        <span class="status-text" id="connectionStatusText">Disconnected</span>
                    </div>
                    <div class="last-update" id="lastUpdateTime">Not connected</div>
                    <div class="last-update mt-1">
                        <small>Active: <span id="activeConnections">0</span> connections</small>
                    </div>
                </div>
            </div>
            
            <!-- Main Content -->
            <div class="main-content">
                <!-- Header -->
                <header class="header">
                    <div class="header-left">
                        <button class="btn-icon" onclick="toggleSidebar()">
                            <i class="fas fa-bars"></i>
                        </button>
                        <div>
                            <h1 class="page-title" id="pageTitle">Dashboard</h1>
                            <p class="page-subtitle" id="pageSubtitle">Real-time monitoring and management</p>
                        </div>
                    </div>
                    
                    <div class="header-actions">
                        <button class="btn-icon" onclick="forceRefreshData()" title="Refresh Data">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="btn-icon" onclick="showBroadcastModal()" title="Broadcast">
                            <i class="fas fa-bullhorn"></i>
                        </button>
                        <button class="btn-icon" onclick="focusTelebirrNumber()" title="Telebirr">
                            <i class="fas fa-phone"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="logout()">
                            <i class="fas fa-sign-out-alt"></i>
                            Logout
                        </button>
                    </div>
                </header>
                
                <!-- Content Sections -->
                
                <!-- Overview Section -->
                <section id="overviewSection" class="content-section active">
                    <div class="stats-grid mb-5">
                        <!-- Total Users -->
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-icon users">
                                    <i class="fas fa-users"></i>
                                </div>
                                <div class="stat-title">
                                    <h3>Total Users</h3>
                                    <div class="stat-value" id="totalUsers">0</div>
                                </div>
                            </div>
                            <div class="stat-change">
                                <i class="fas fa-database"></i>
                                <span>Registered users</span>
                            </div>
                        </div>
                        
                        <!-- Online Players -->
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-icon online">
                                    <i class="fas fa-signal"></i>
                                </div>
                                <div class="stat-title">
                                    <h3>Online Players</h3>
                                    <div class="stat-value" id="onlinePlayers">0</div>
                                </div>
                            </div>
                            <div class="stat-change positive">
                                <i class="fas fa-circle"></i>
                                <span id="onlineStatus">Connected now</span>
                            </div>
                        </div>
                        
                        <!-- House Earnings -->
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-icon balance">
                                    <i class="fas fa-coins"></i>
                                </div>
                                <div class="stat-title">
                                    <h3>House Earnings</h3>
                                    <div class="stat-value" id="houseEarnings">0 ETB</div>
                                </div>
                            </div>
                            <div class="stat-change positive d-flex align-center justify-between">
                                <span>
                                    <i class="fas fa-trend-up"></i>
                                    From fees
                                </span>
                                <button class="btn btn-danger btn-sm" onclick="resetHouseEarnings()" title="Reset House Earnings">
                                    <i class="fas fa-undo"></i>
                                    Reset
                                </button>
                            </div>
                        </div>
                        
                        <!-- Pending Transactions -->
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-icon agents">
                                    <i class="fas fa-clock"></i>
                                </div>
                                <div class="stat-title">
                                    <h3>Pending Requests</h3>
                                    <div class="stat-value" id="pendingRequests">0</div>
                                </div>
                            </div>
                            <div class="stat-change">
                                <i class="fas fa-exclamation-circle"></i>
                                <span>Need approval</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Quick Actions -->
                    <div class="mb-5">
                        <div class="card-header mb-4">
                            <h2 class="card-title">Quick Actions</h2>
                            <p class="card-subtitle">Frequently used management actions</p>
                        </div>
                        <div class="quick-actions-grid">
                            <div class="quick-action-card" onclick="showAddFundsModal()">
                                <div class="quick-action-icon">
                                    <i class="fas fa-money-bill-wave"></i>
                                </div>
                                <div class="quick-action-title">Add Funds</div>
                                <div class="quick-action-desc">Add ETB to player account</div>
                            </div>
                            
                            <div class="quick-action-card" onclick="showBroadcastModal()">
                                <div class="quick-action-icon">
                                    <i class="fas fa-bullhorn"></i>
                                </div>
                                <div class="quick-action-title">Broadcast</div>
                                <div class="quick-action-desc">Send message to all players</div>
                            </div>
                            
                            <div class="quick-action-card" onclick="focusTelebirrNumber()">
                                <div class="quick-action-icon">
                                    <i class="fas fa-phone"></i>
                                </div>
                                <div class="quick-action-title">Telebirr Number</div>
                                <div class="quick-action-desc">Update deposit phone number</div>
                            </div>
                            
                            <div class="quick-action-card" onclick="showCreateAgentModal()">
                                <div class="quick-action-icon" style="background: rgba(139, 92, 246, 0.1); color: var(--agent);">
                                    <i class="fas fa-user-plus"></i>
                                </div>
                                <div class="quick-action-title">Create Agent</div>
                                <div class="quick-action-desc">Add new agent account</div>
                            </div>
                            
                            <div class="quick-action-card" onclick="showPendingRequests()">
                                <div class="quick-action-icon" style="background: rgba(245, 158, 11, 0.1); color: var(--warning);">
                                    <i class="fas fa-clock"></i>
                                </div>
                                <div class="quick-action-title">Pending Requests</div>
                                <div class="quick-action-desc">View pending approvals</div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Recent Deposit/Withdrawal Requests -->
                    <div class="mb-5">
                        <div class="card">
                            <div class="card-header d-flex align-center justify-between">
                                <div>
                                    <h2 class="card-title">Recent Requests</h2>
                                    <p class="card-subtitle">Latest deposit/withdrawal requests</p>
                                </div>
                                <button class="btn btn-primary btn-sm" onclick="refreshPendingTransactions()">
                                    <i class="fas fa-sync"></i>
                                    Refresh
                                </button>
                            </div>
                            <div class="table-responsive">
                                <table class="table" id="recentRequestsTable">
                                    <thead>
                                        <tr>
                                            <th>User</th>
                                            <th>Type</th>
                                            <th>Amount</th>
                                            <th>Details</th>
                                            <th>Time</th>
                                            <th>Status</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody id="recentRequestsTableBody">
                                        <!-- Recent requests will be inserted here -->
                                        <tr>
                                            <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
                                                <i class="fas fa-inbox"></i>
                                                <div class="mt-2">No recent requests</div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Recent Activity -->
                    <div class="card">
                        <div class="table-header">
                            <div class="table-title">Recent Activity</div>
                            <div class="table-controls">
                                <button class="btn btn-primary btn-sm" onclick="refreshActivity()">
                                    <i class="fas fa-sync"></i>
                                    Refresh
                                </button>
                            </div>
                        </div>
                        <div class="activity-feed" id="activityFeed" style="max-height: 400px; overflow-y: auto; padding: var(--spacing-lg);">
                            <!-- Activity items will be inserted here -->
                        </div>
                    </div>
                </section>
                
                <!-- User Management Section -->
                <section id="usersSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">User Management</div>
                            <div class="table-controls">
                                <div class="filters">
                                    <div class="filter-group">
                                        <label class="filter-label">Search</label>
                                        <input type="text" id="userSearch" class="form-input" placeholder="Search users..." onkeyup="searchUsers()">
                                    </div>
                                    <div class="filter-group">
                                        <label class="filter-label">Status</label>
                                        <select id="statusFilter" class="select" onchange="applyFilters()">
                                            <option value="all">All Users</option>
                                            <option value="online">Online Only</option>
                                            <option value="offline">Offline Only</option>
                                            <option value="telegram">Telegram Users</option>
                                            <option value="multi">Multiple Sockets</option>
                                            <option value="hasAgent">Has Agent</option>
                                            <option value="noAgent">No Agent</option>
                                        </select>
                                    </div>
                                </div>
                                <div class="action-buttons">
                                    <button class="btn btn-primary btn-sm" onclick="showAddFundsModal()">
                                        <i class="fas fa-plus"></i>
                                        Add Funds
                                    </button>
                                    <button class="btn btn-primary btn-sm" onclick="showAssignAgentModal()">
                                        <i class="fas fa-user-tie"></i>
                                        Assign Agent
                                    </button>
                                    <button class="btn btn-primary btn-sm" onclick="exportUsers()">
                                        <i class="fas fa-download"></i>
                                        Export
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="table-responsive">
                            <table class="table" id="usersTable">
                                <thead>
                                    <tr>
                                        <th>User</th>
                                        <th>Balance</th>
                                        <th>Agent</th>
                                        <th>Status</th>
                                        <th>Sockets</th>
                                        <th>Room</th>
                                        <th>Activity</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="usersTableBody">
                                    <!-- Users will be inserted here -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
                
                <!-- Agent Management Section -->
                <section id="agentsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">Agent Management</div>
                            <div class="table-controls">
                                <button class="btn btn-primary" onclick="showCreateAgentModal()">
                                    <i class="fas fa-plus"></i>
                                    Create Agent
                                </button>
                                <button class="btn btn-primary" onclick="refreshAgents()">
                                    <i class="fas fa-sync"></i>
                                    Refresh
                                </button>
                            </div>
                        </div>
                        <table class="table" id="agentsTable">
                            <thead>
                                <tr>
                                    <th>Agent</th>
                                    <th>Referral Code</th>
                                    <th>Commission Rate</th>
                                    <th>Referrals</th>
                                    <th>Earnings</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="agentsTableBody">
                                <!-- Agents will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                </section>
                
                <!-- Deposit Requests Section -->
                <section id="depositRequestsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">Deposit Requests</div>
                            <div class="table-controls">
                                <div class="filters">
                                    <div class="filter-group">
                                        <label class="filter-label">Status</label>
                                        <select class="select" id="depositStatusFilter" onchange="filterDepositRequests()">
                                            <option value="all">All</option>
                                            <option value="pending">Pending</option>
                                            <option value="approved">Approved</option>
                                            <option value="rejected">Rejected</option>
                                        </select>
                                    </div>
                                    <div class="filter-group">
                                        <label class="filter-label">Date Range</label>
                                        <select class="select" id="depositDateFilter" onchange="filterDepositRequests()">
                                            <option value="all">All Time</option>
                                            <option value="today">Today</option>
                                            <option value="week">This Week</option>
                                            <option value="month">This Month</option>
                                        </select>
                                    </div>
                                </div>
                                <button class="btn btn-primary" onclick="refreshDepositRequests()">
                                    <i class="fas fa-sync"></i>
                                    Refresh
                                </button>
                            </div>
                        </div>
                        <table class="table" id="depositRequestsTable">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Amount</th>
                                    <th>Receipt Number</th>
                                    <th>Phone</th>
                                    <th>Status</th>
                                    <th>Time</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="depositRequestsTableBody">
                                <!-- Deposit requests will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                </section>
                
                <!-- Withdrawal Requests Section -->
                <section id="withdrawalRequestsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">Withdrawal Requests</div>
                            <div class="table-controls">
                                <div class="filters">
                                    <div class="filter-group">
                                        <label class="filter-label">Status</label>
                                        <select class="select" id="withdrawalStatusFilter" onchange="filterWithdrawalRequests()">
                                            <option value="all">All</option>
                                            <option value="pending">Pending</option>
                                            <option value="approved">Approved</option>
                                            <option value="rejected">Rejected</option>
                                        </select>
                                    </div>
                                    <div class="filter-group">
                                        <label class="filter-label">Date Range</label>
                                        <select class="select" id="withdrawalDateFilter" onchange="filterWithdrawalRequests()">
                                            <option value="all">All Time</option>
                                            <option value="today">Today</option>
                                            <option value="week">This Week</option>
                                            <option value="month">This Month</option>
                                        </select>
                                    </div>
                                </div>
                                <button class="btn btn-primary" onclick="refreshWithdrawalRequests()">
                                    <i class="fas fa-sync"></i>
                                    Refresh
                                </button>
                            </div>
                        </div>
                        <table class="table" id="withdrawalRequestsTable">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Amount</th>
                                    <th>Phone Number</th>
                                    <th>Status</th>
                                    <th>Time</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="withdrawalRequestsTableBody">
                                <!-- Withdrawal requests will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                </section>
                
                <!-- Wallet Approvals Section (Deposit/Withdrawal Approvals) -->
                <section id="walletApprovalsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">Wallet Approvals</div>
                            <div class="table-controls">
                                <button class="btn btn-primary" onclick="refreshPendingTransactions()">
                                    <i class="fas fa-sync"></i>
                                    Refresh
                                </button>
                                <button class="btn btn-warning" onclick="clearAllApprovedTransactions()" title="Clear Approved/Rejected from view">
                                    <i class="fas fa-trash"></i>
                                    Clear History
                                </button>
                                <button class="btn btn-danger" onclick="resetAllTransactions()" title="Reset ALL Transactions (including pending)">
                                    <i class="fas fa-undo"></i>
                                    Reset All
                                </button>
                            </div>
                        </div>
                        <div class="filters mb-4">
                            <div class="filter-group">
                                <label class="filter-label">Transaction Type</label>
                                <select class="select" id="walletTypeFilter" onchange="filterWalletTransactions()">
                                    <option value="all">All</option>
                                    <option value="deposit">Deposits</option>
                                    <option value="withdraw">Withdrawals</option>
                                </select>
                            </div>
                            <div class="filter-group">
                                <label class="filter-label">Status</label>
                                <select class="select" id="walletStatusFilter" onchange="filterWalletTransactions()">
                                    <option value="pending">Pending</option>
                                    <option value="all">All Status</option>
                                    <option value="approved">Approved</option>
                                    <option value="rejected">Rejected</option>
                                </select>
                            </div>
                        </div>
                        <table class="table" id="walletApprovalsTable">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Type</th>
                                    <th>Amount</th>
                                    <th>Details</th>
                                    <th>Time</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="walletApprovalsTableBody">
                                <!-- Pending transactions will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                </section>
                
                <!-- Transactions Section -->
                <section id="transactionsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">Transaction History</div>
                            <div class="table-controls">
                                <div class="filters">
                                    <div class="filter-group">
                                        <input type="text" id="transactionSearch" class="form-input" placeholder="Search transactions..." onkeyup="searchTransactions()">
                                    </div>
                                    <div class="filter-group">
                                        <select class="select" id="transactionTypeFilter" onchange="applyTransactionFilters()">
                                            <option value="all">All Transactions</option>
                                            <option value="bingo">Bingo Wins</option>
                                            <option value="keno">Keno Wins</option>
                                            <option value="deposit">Deposits</option>
                                            <option value="withdrawal">Withdrawals</option>
                                            <option value="agent">Agent Commissions</option>
                                            <option value="bonus">Bonuses</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="transaction-history" id="transactionHistory" style="max-height: 500px; overflow-y: auto;">
                            <!-- Transactions will be inserted here -->
                        </div>
                    </div>
                </section>
                
                <!-- Rooms Section -->
                <section id="roomsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">Game Rooms</div>
                            <div class="table-controls">
                                <button class="btn btn-primary" onclick="forceStartAllGames()">
                                    <i class="fas fa-play"></i>
                                    Start All
                                </button>
                            </div>
                        </div>
                        <table class="table" id="roomsTable">
                            <thead>
                                <tr>
                                    <th>Room</th>
                                    <th>Players</th>
                                    <th>Status</th>
                                    <th>Prize Pool</th>
                                    <th>House Fee</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="roomsTableBody">
                                <!-- Rooms will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                </section>
                
                <!-- Analytics Section -->
                <section id="analyticsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">Analytics Dashboard</div>
                            <div class="table-controls">
                                <select class="select" id="analyticsDateRange" onchange="updateAnalytics()">
                                    <option value="today">Today</option>
                                    <option value="week">Last 7 days</option>
                                    <option value="month">Last 30 days</option>
                                    <option value="all">All time</option>
                                </select>
                            </div>
                        </div>
                        <div class="stats-grid mt-4">
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-money-bill-wave"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Total Deposits</h3>
                                        <div class="stat-value" id="totalDeposits">0 ETB</div>
                                    </div>
                                </div>
                                <div class="stat-change">
                                    <i class="fas fa-chart-line"></i>
                                    <span id="depositChange">0%</span>
                                </div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-money-check-alt"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Total Withdrawals</h3>
                                        <div class="stat-value" id="totalWithdrawals">0 ETB</div>
                                    </div>
                                </div>
                                <div class="stat-change">
                                    <i class="fas fa-chart-line"></i>
                                    <span id="withdrawalChange">0%</span>
                                </div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-home"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Net Profit</h3>
                                        <div class="stat-value" id="netProfit">0 ETB</div>
                                    </div>
                                </div>
                                <div class="stat-change positive">
                                    <i class="fas fa-arrow-up"></i>
                                    <span>Commission</span>
                                </div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-users"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Active Users</h3>
                                        <div class="stat-value" id="activeUsers">0</div>
                                    </div>
                                </div>
                                <div change="stat-change">
                                    <i class="fas fa-user-check"></i>
                                    <span>Last 24h</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Chart Container -->
                        <div class="chart-card mt-5">
                            <h3 class="mb-4">Transaction Trends</h3>
                            <div class="chart-container">
                                <canvas id="transactionChart"></canvas>
                            </div>
                        </div>
                    </div>
                </section>
                
                <!-- Controls Section -->
                <section id="controlsSection" class="content-section">
                    <div class="card">
                        <div class="card-header mb-4">
                            <h2 class="card-title">System Controls</h2>
                            <p class="card-subtitle">System settings and configurations</p>
                        </div>
                        
                        <!-- Telebirr Number Setting -->
                        <div class="form-group mb-4">
                            <label class="form-label">Telebirr Phone Number</label>
                            <div class="d-flex gap-2">
                                <div class="input-with-icon" style="flex: 1;">
                                    <i class="fas fa-phone input-icon"></i>
                                    <input type="text" id="telebirrNumber" class="form-input" value="0962577855" placeholder="Enter Telebirr phone number">
                                </div>
                                <button class="btn btn-primary" onclick="updateTelebirrNumber()">
                                    <i class="fas fa-save"></i>
                                    Update
                                </button>
                            </div>
                            <div class="text-muted mt-1">
                                This number is shown to players for depositing funds. Must be an Ethiopian number (09xxxxxxxx)
                            </div>
                            <div id="telebirrNumberStatus" class="mt-2"></div>
                        </div>
                        
                        <!-- Game Settings -->
                        <div class="form-row mb-4">
                            <div class="form-group">
                                <label class="form-label">Game Timer (seconds)</label>
                                <input type="number" id="gameTimer" class="form-input" value="3">
                                <button class="btn btn-primary mt-2" onclick="updateGameTimer()">
                                    Update
                                </button>
                            </div>
                            
                            <div class="form-group">
                                <label class="form-label">Minimum Players to Start</label>
                                <input type="number" id="minPlayers" class="form-input" value="2">
                                <button class="btn btn-primary mt-2" onclick="updateMinPlayers()">
                                    Update
                                </button>
                            </div>
                        </div>
                        
                        <!-- Transaction Settings -->
                        <div class="mt-5 pt-4 border-top">
                            <h3 class="mb-4"><i class="fas fa-cog"></i> Transaction Settings</h3>
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label">Minimum Deposit (ETB)</label>
                                    <input type="number" id="minDeposit" class="form-input" value="10" min="1">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Minimum Withdrawal (ETB)</label>
                                    <input type="number" id="minWithdrawal" class="form-input" value="50" min="1">
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label">Max Withdrawal (ETB)</label>
                                    <input type="number" id="maxWithdrawal" class="form-input" value="5000" min="1">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Auto-approve under (ETB)</label>
                                    <input type="number" id="autoApproveLimit" class="form-input" value="100" min="0">
                                </div>
                            </div>
                            <button class="btn btn-primary" onclick="updateTransactionSettings()">
                                <i class="fas fa-save"></i>
                                Update Transaction Settings
                            </button>
                        </div>
                        
                        <!-- Agent System Settings -->
                        <div class="mt-5 pt-4 border-top">
                            <h3 class="mb-4"><i class="fas fa-user-tie"></i> Agent System Settings</h3>
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label">Default Bingo Commission (%)</label>
                                    <input type="number" id="defaultBingoCommission" class="form-input" value="40" min="0" max="100">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Default Keno Commission (%)</label>
                                    <input type="number" id="defaultKenoCommission" class="form-input" value="10" min="0" max="100">
                                </div>
                            </div>
                            <button class="btn btn-agent" onclick="updateDefaultCommissions()">
                                <i class="fas fa-save"></i>
                                Update Default Commissions
                            </button>
                        </div>
                    </div>
                </section>
                
                <!-- Logs Section -->
                <section id="logsSection" class="content-section">
                    <div class="table-container">
                        <div class="table-header">
                            <div class="table-title">System Logs</div>
                            <div class="table-controls">
                                <button class="btn btn-primary" onclick="clearLogs()">
                                    <i class="fas fa-trash"></i>
                                    Clear Logs
                                </button>
                                <button class="btn btn-primary" onclick="exportLogs()">
                                    <i class="fas fa-download"></i>
                                    Export
                                </button>
                            </div>
                        </div>
                        <div class="filters mb-4">
                            <div class="filter-group">
                                <label class="filter-label">Log Type</label>
                                <select class="select" id="logTypeFilter" onchange="filterLogs()">
                                    <option value="all">All Logs</option>
                                    <option value="info">Info</option>
                                    <option value="error">Errors</option>
                                    <option value="warning">Warnings</option>
                                    <option value="agent">Agent System</option>
                                    <option value="transaction">Transactions</option>
                                </select>
                            </div>
                        </div>
                        <div class="activity-feed" id="systemLogs" style="max-height: 500px; overflow-y: auto; padding: var(--spacing-lg);">
                            <!-- System logs will be inserted here -->
                        </div>
                    </div>
                </section>
                
                <!-- Debug Section -->
                <section id="debugSection" class="content-section">
                    <div class="card">
                        <div class="card-header mb-4">
                            <h2 class="card-title">Debug Information</h2>
                            <p class="card-subtitle">System diagnostics and monitoring</p>
                        </div>
                        <div class="stats-grid mb-5">
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-plug"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Socket Connections</h3>
                                        <div class="stat-value" id="debugSockets">0</div>
                                    </div>
                                </div>
                                <div class="stat-change">
                                    <i class="fas fa-network-wired"></i>
                                    <span>Active sockets</span>
                                </div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-database"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Stored Transactions</h3>
                                        <div class="stat-value" id="debugStoredTransactions">0</div>
                                    </div>
                                </div>
                                <div class="stat-change">
                                    <i class="fas fa-save"></i>
                                    <span>In database</span>
                                </div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-shield-alt"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Admin Sessions</h3>
                                        <div class="stat-value" id="debugAdmins">0</div>
                                    </div>
                                </div>
                                <div class="stat-change">
                                    <i class="fas fa-user-secret"></i>
                                    <span>Active admin</span>
                                </div>
                            </div>
                            
                            <div class="stat-card">
                                <div class="stat-header">
                                    <div class="stat-icon">
                                        <i class="fas fa-robot"></i>
                                    </div>
                                    <div class="stat-title">
                                        <h3>Multi-Socket Users</h3>
                                        <div class="stat-value" id="debugMultiSocketUsers">0</div>
                                    </div>
                                </div>
                                <div class="stat-change">
                                    <i class="fas fa-mobile-alt"></i>
                                    <span>Multiple devices</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- System Actions -->
                        <div class="mt-5">
                            <h3 class="mb-4">System Actions</h3>
                            <div class="d-flex flex-wrap gap-3">
                                <button class="btn btn-warning" onclick="clearTransactionCache()">
                                    <i class="fas fa-trash"></i>
                                    Clear Transaction Cache
                                </button>
                                <button class="btn btn-danger" onclick="resetAllTransactions()">
                                    <i class="fas fa-undo"></i>
                                    Reset All Transactions
                                </button>
                                <button class="btn btn-info" onclick="testNotification()">
                                    <i class="fas fa-bell"></i>
                                    Test Notification
                                </button>
                                <button class="btn btn-success" onclick="testServerConnection()">
                                    <i class="fas fa-network-wired"></i>
                                    Test Server Connection
                                </button>
                                <button class="btn btn-primary" onclick="backupDatabase()">
                                    <i class="fas fa-download"></i>
                                    Backup Database
                                </button>
                            </div>
                            <div class="mt-4">
                                <button class="btn btn-secondary" onclick="window.debugConnection()">
                                    <i class="fas fa-bug"></i>
                                    Run Connection Debug
                                </button>
                                <small class="text-muted ml-2">(Check browser console for details)</small>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    </div>

    <!-- Modals -->
    
    <!-- Add Funds Modal -->
    <div id="addFundsModal" class="modal-overlay">
        <div class="modal">
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-money-bill-wave"></i> Add Funds</h2>
                <button class="modal-close" onclick="hideModal('addFundsModal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Select User</label>
                    <input list="fundsUserList" id="fundsUserId" class="form-input" placeholder="Type user ID or name to search..." autocomplete="off">
                    <datalist id="fundsUserList"></datalist>
                    <div class="text-muted mt-1">
                        Search by name or user ID. Online users are marked with 🟢
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Amount (ETB)</label>
                    <input type="number" id="fundsAmount" class="form-input" placeholder="Enter amount" step="0.01" min="0.01">
                </div>
                
                <div class="filters mb-4">
                    <button class="btn btn-primary btn-sm" onclick="setAmount(10)">+10</button>
                    <button class="btn btn-primary btn-sm" onclick="setAmount(50)">+50</button>
                    <button class="btn btn-primary btn-sm" onclick="setAmount(100)">+100</button>
                    <button class="btn btn-primary btn-sm" onclick="setAmount(500)">+500</button>
                    <button class="btn btn-primary btn-sm" onclick="setAmount(1000)">+1000</button>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Reason (Optional)</label>
                    <select id="fundsReason" class="form-input">
                        <option value="manual">Manual Addition</option>
                        <option value="deposit_approval">Deposit Approval</option>
                        <option value="bonus">Bonus</option>
                        <option value="refund">Refund</option>
                        <option value="correction">Balance Correction</option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="hideModal('addFundsModal')">Cancel</button>
                <button class="btn btn-primary" onclick="addFunds()">
                    <i class="fas fa-check"></i>
                    Add Funds
                </button>
            </div>
        </div>
    </div>
    
    <!-- Broadcast Modal -->
    <div id="broadcastModal" class="modal-overlay">
        <div class="modal">
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-bullhorn"></i> Broadcast Message</h2>
                <button class="modal-close" onclick="hideModal('broadcastModal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Message</label>
                    <textarea id="broadcastMessage" class="form-input" placeholder="Enter message to broadcast to all players..." rows="4" style="resize: vertical;"></textarea>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Message Type</label>
                    <select id="broadcastType" class="form-input">
                        <option value="info">Information</option>
                        <option value="warning">Warning</option>
                        <option value="success">Success</option>
                        <option value="maintenance">Maintenance</option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="hideModal('broadcastModal')">Cancel</button>
                <button class="btn btn-primary" onclick="sendBroadcast()">
                    <i class="fas fa-paper-plane"></i>
                    Send Broadcast
                </button>
            </div>
        </div>
    </div>
    
    <!-- Create Agent Modal -->
    <div id="agentModal" class="modal-overlay">
        <div class="modal" style="max-width: 600px;">
            <div class="modal-header">
                <h2 class="modal-title" id="agentModalTitle"><i class="fas fa-user-tie"></i> Create New Agent</h2>
                <button class="modal-close" onclick="hideModal('agentModal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Username</label>
                    <input type="text" id="agentUsername" class="form-input" placeholder="Enter username" autocomplete="off">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Password</label>
                    <input type="password" id="agentPassword" class="form-input" placeholder="Enter password" autocomplete="new-password">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Full Name</label>
                    <input type="text" id="agentName" class="form-input" placeholder="Enter full name">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Phone Number</label>
                    <input type="text" id="agentPhone" class="form-input" placeholder="09xxxxxxxx" pattern="^09[0-9]{8}$">
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Bingo Commission (%)</label>
                        <input type="number" id="agentBingoRate" class="form-input" value="40" min="0" max="100" step="0.5">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Keno Commission (%)</label>
                        <input type="number" id="agentKenoRate" class="form-input" value="10" min="0" max="100" step="0.5">
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="d-flex align-center gap-2">
                        <input type="checkbox" id="agentIsSuperAdmin">
                        <span>Super Admin Privileges</span>
                    </label>
                </div>
                
                <div class="form-group">
                    <label class="d-flex align-center gap-2">
                        <input type="checkbox" id="agentIsActive" checked>
                        <span>Active Account</span>
                    </label>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="hideModal('agentModal')">Cancel</button>
                <button class="btn btn-primary" onclick="saveAgent()">
                    <i class="fas fa-save"></i>
                    Save Agent
                </button>
            </div>
        </div>
    </div>
    
    <!-- Assign Agent Modal -->
    <div id="assignAgentModal" class="modal-overlay">
        <div class="modal" style="max-width: 500px;">
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-link"></i> Assign User to Agent</h2>
                <button class="modal-close" onclick="hideModal('assignAgentModal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Select User</label>
                    <select id="assignUserSelect" class="form-input">
                        <option value="">Select a user</option>
                        <!-- Users will be populated here -->
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">User ID (Optional)</label>
                    <input type="text" id="assignUserId" class="form-input" placeholder="Enter user ID if not in list">
                </div>
                
                <div class="form-group">
                    <label class="form-label">Select Agent</label>
                    <select id="assignAgentSelect" class="form-input">
                        <option value="">Select an agent</option>
                        <!-- Agents will be populated here -->
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="d-flex align-center gap-2">
                        <input type="checkbox" id="assignOverride" checked>
                        <span>Override Existing Agent</span>
                    </label>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="hideModal('assignAgentModal')">Cancel</button>
                <button class="btn btn-primary" onclick="assignUserToAgent()">
                    <i class="fas fa-link"></i>
                    Assign User to Agent
                </button>
            </div>
        </div>
    </div>
    
    <!-- Quick Add Funds Modal -->
    <div id="quickAddFundsModal" class="modal-overlay">
        <div class="modal" style="max-width: 400px;">
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-money-bill-wave"></i> Quick Add Funds</h2>
                <button class="modal-close" onclick="hideModal('quickAddFundsModal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">User</label>
                    <div class="d-flex align-center gap-2 p-2 bg-dark-3 rounded">
                        <div class="user-avatar" id="quickAddUserAvatar">U</div>
                        <div>
                            <div style="font-weight: 600;" id="quickAddUserName">Loading...</div>
                            <div class="text-muted" style="font-size: 0.75rem;" id="quickAddUserId">...</div>
                        </div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Current Balance</label>
                    <div class="p-2 bg-dark-3 rounded text-center">
                        <span style="font-weight: 700; font-size: 1.5rem;" id="quickAddCurrentBalance">0 ETB</span>
                    </div>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Amount to Add (ETB)</label>
                    <input type="number" id="quickAddAmount" class="form-input" placeholder="Enter amount" step="0.01" min="0.01" value="100">
                </div>
                
                <div class="filters mb-4 d-flex flex-wrap gap-2">
                    <button class="btn btn-primary btn-sm" onclick="setQuickAmount(50)">+50</button>
                    <button class="btn btn-primary btn-sm" onclick="setQuickAmount(100)">+100</button>
                    <button class="btn btn-primary btn-sm" onclick="setQuickAmount(200)">+200</button>
                    <button class="btn btn-primary btn-sm" onclick="setQuickAmount(500)">+500</button>
                    <button class="btn btn-primary btn-sm" onclick="setQuickAmount(1000)">+1000</button>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="hideModal('quickAddFundsModal')">Cancel</button>
                <button class="btn btn-primary" onclick="quickAddFunds()">
                    <i class="fas fa-check"></i>
                    Add Funds
                </button>
            </div>
        </div>
    </div>
    
    <!-- Transaction Details Modal -->
    <div id="transactionDetailsModal" class="modal-overlay">
        <div class="modal" style="max-width: 500px;">
            <div class="modal-header">
                <h2 class="modal-title"><i class="fas fa-receipt"></i> Transaction Details</h2>
                <button class="modal-close" onclick="hideModal('transactionDetailsModal')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="transaction-details-content" id="transactionDetailsContent">
                    <!-- Transaction details will be inserted here -->
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn" onclick="hideModal('transactionDetailsModal')">Close</button>
                <button class="btn btn-primary" onclick="printTransactionDetails()">
                    <i class="fas fa-print"></i>
                    Print
                </button>
            </div>
        </div>
    </div>

    <!-- Toast Container -->
    <div class="toast-container" id="toastContainer"></div>

    <!-- Include the external JavaScript file -->
    <script src="admin-logic.js"></script>
</body>
</html>
