from utils import calculate_class_minutes

def test_calculate_class_minutes():
    print("Testing calculate_class_minutes...")

    # Standard cases
    assert calculate_class_minutes("09:00", "10:30") == 90
    assert calculate_class_minutes("13:15", "14:45") == 90
    assert calculate_class_minutes("08:00", "08:00") == 0
    assert calculate_class_minutes("23:00", "00:00") == -1380 # Assuming same day, 0 - 1380

    # Edge cases / Invalid inputs
    assert calculate_class_minutes("", "10:30") == 0
    assert calculate_class_minutes("09:00", "") == 0
    assert calculate_class_minutes("abc", "10:30") == 0
    assert calculate_class_minutes("09:00", "def") == 0
    assert calculate_class_minutes(None, "10:30") == 0
    assert calculate_class_minutes("09:00", None) == 0

    print("All tests passed!")

if __name__ == "__main__":
    test_calculate_class_minutes()
