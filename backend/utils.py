def calculate_class_minutes(start_time: str, end_time: str) -> int:
    try:
        sh, sm = start_time.split(':')
        eh, em = end_time.split(':')
        return (int(eh) * 60 + int(em)) - (int(sh) * 60 + int(sm))
    except Exception:
        return 0
