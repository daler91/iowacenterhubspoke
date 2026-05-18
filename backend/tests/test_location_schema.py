from models.schemas import LocationCreate, LocationUpdate
from routers.locations import build_location_update_data


def test_location_create_accepts_optional_address():
    location = LocationCreate(
        city_name="Des Moines, IA",
        drive_time_minutes=15,
        address="2210 Grand Ave, Des Moines, IA 50312",
        latitude=41.5868,
        longitude=-93.654,
    )

    assert location.address == "2210 Grand Ave, Des Moines, IA 50312"


def test_location_update_preserves_omitted_fields():
    update = LocationUpdate(city_name="Ames, IA")

    assert build_location_update_data(update) == {"city_name": "Ames, IA"}


def test_location_update_can_clear_nullable_address_and_coordinates():
    update = LocationUpdate(address=None, latitude=None, longitude=None)

    assert build_location_update_data(update) == {
        "address": None,
        "latitude": None,
        "longitude": None,
    }
