import uuid
from datetime import datetime, timezone
from database import db
from core.logger import get_logger

logger = get_logger(__name__)

TEMPLATES = [
    {
        "name": "Single-session workshop",
        "class_type": "workshop",
        "default_tasks": [
            {"title": "Confirm date and time with partner", "phase": "planning", "owner": "internal", "offset_days": -42, "details": "Check against partner calendar and local conflicts"},
            {"title": "Confirm room and AV details", "phase": "planning", "owner": "partner", "offset_days": -38, "details": "Capacity, AV setup, Wi-Fi, parking, signage"},
            {"title": "Finalize workshop content", "phase": "planning", "owner": "internal", "offset_days": -35, "details": "Slide deck, handouts, prompt cheat sheets"},
            {"title": "Draft flyer and promo materials", "phase": "planning", "owner": "internal", "offset_days": -32, "details": "Customizable per community with logos and venue"},
            {"title": "Partner approves flyer", "phase": "planning", "owner": "partner", "offset_days": -30, "details": "Review for accuracy and co-branding"},
            {"title": "Set up registration", "phase": "planning", "owner": "internal", "offset_days": -28, "details": "Google Form, Eventbrite, or platform-native"},
            {"title": "Identify local co-promoters", "phase": "planning", "owner": "both", "offset_days": -28, "details": "Other orgs, social media pages, newsletters"},
            {"title": "Share flyer to partner channels", "phase": "promotion", "owner": "partner", "offset_days": -28, "details": "Newsletter, social, lobby posting, website"},
            {"title": "Share flyer to Iowa Center channels", "phase": "promotion", "owner": "internal", "offset_days": -28, "details": "Email list, social, cross-posts"},
            {"title": "Send reminder to co-promoters", "phase": "promotion", "owner": "internal", "offset_days": -21, "details": "Chamber newsletter deadlines, local media"},
            {"title": "Registration check-in (midpoint)", "phase": "promotion", "owner": "internal", "offset_days": -14, "details": "Review numbers, decide if extra push needed"},
            {"title": "Final reminder blast", "phase": "promotion", "owner": "both", "offset_days": -5, "details": "3-5 days before event"},
            {"title": "Confirm headcount with partner", "phase": "promotion", "owner": "internal", "offset_days": -3, "details": "Room setup, materials count"},
            {"title": "Confirm room setup", "phase": "delivery", "owner": "partner", "offset_days": 0, "details": "Tables, chairs, projector, Wi-Fi credentials"},
            {"title": "Arrive for tech check", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "30-45 minutes before start"},
            {"title": "Run sign-in and check-in", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "Capture attendee info for follow-up"},
            {"title": "Deliver workshop", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": ""},
            {"title": "Distribute implementation kit", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "Handouts, cheat sheets, resource links"},
            {"title": "Collect feedback survey", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": "Paper or QR code to digital survey"},
            {"title": "Send thank-you to partner", "phase": "follow_up", "owner": "internal", "offset_days": 1, "details": "Include attendance summary, photos"},
            {"title": "Send attendee follow-up email", "phase": "follow_up", "owner": "internal", "offset_days": 2, "details": "Survey link, resources, next steps"},
            {"title": "Log attendance and outcomes", "phase": "follow_up", "owner": "internal", "offset_days": 5, "details": "How many, who, warm leads for coaching/lending"},
            {"title": "Schedule partner debrief", "phase": "follow_up", "owner": "internal", "offset_days": 7, "details": "What worked, what to adjust, next session interest"},
            {"title": "Update partner org profile", "phase": "follow_up", "owner": "internal", "offset_days": 10, "details": "Notes on venue, relationship, future availability"},
        ],
    },
    {
        "name": "New partner onboarding",
        "class_type": "onboarding",
        "default_tasks": [
            {"title": "Intro meeting or call", "phase": "planning", "owner": "internal", "offset_days": -42, "details": ""},
            {"title": "Identify partner goals and audience needs", "phase": "planning", "owner": "internal", "offset_days": -38, "details": ""},
            {"title": "Share org overview and service menu", "phase": "planning", "owner": "internal", "offset_days": -35, "details": ""},
            {"title": "Confirm mutual interest", "phase": "planning", "owner": "both", "offset_days": -30, "details": ""},
            {"title": "Identify primary and secondary contacts", "phase": "promotion", "owner": "partner", "offset_days": -28, "details": ""},
            {"title": "Collect venue details", "phase": "promotion", "owner": "partner", "offset_days": -25, "details": "Capacity, AV, schedule availability"},
            {"title": "Agree on co-branding guidelines", "phase": "promotion", "owner": "both", "offset_days": -21, "details": ""},
            {"title": "Agree on promotion responsibilities", "phase": "promotion", "owner": "both", "offset_days": -21, "details": ""},
            {"title": "Select first class to pilot", "phase": "promotion", "owner": "both", "offset_days": -18, "details": ""},
            {"title": "Set pilot date", "phase": "promotion", "owner": "both", "offset_days": -14, "details": ""},
            {"title": "Pilot evaluation", "phase": "follow_up", "owner": "both", "offset_days": 7, "details": "Does both sides want to continue? What cadence?"},
            {"title": "Move partner to active status", "phase": "follow_up", "owner": "internal", "offset_days": 10, "details": "Set up quarterly check-in schedule"},
        ],
    },
    {
        "name": "Partner-hosted office hours",
        "class_type": "office_hours",
        "default_tasks": [
            {"title": "Confirm date with partner", "phase": "planning", "owner": "internal", "offset_days": -14, "details": ""},
            {"title": "Notify partner of visit", "phase": "promotion", "owner": "internal", "offset_days": -7, "details": ""},
            {"title": "Partner posts to their channels", "phase": "promotion", "owner": "partner", "offset_days": -5, "details": "Lobby sign, newsletter mention"},
            {"title": "Show up and set up", "phase": "delivery", "owner": "internal", "offset_days": 0, "details": ""},
            {"title": "Log visitors and conversations", "phase": "follow_up", "owner": "internal", "offset_days": 1, "details": "Track foot traffic, warm leads, follow-up needed"},
        ],
    },
]


async def seed_project_templates():
    """Insert default project templates if the collection is empty."""
    try:
        count = await db.project_templates.count_documents({})
        if count > 0:
            return
        now = datetime.now(timezone.utc).isoformat()
        docs = []
        for tmpl in TEMPLATES:
            docs.append({
                "id": str(uuid.uuid4()),
                "name": tmpl["name"],
                "class_type": tmpl["class_type"],
                "default_tasks": tmpl["default_tasks"],
                "collateral_kit": [],
                "created_at": now,
            })
        await db.project_templates.insert_many(docs)
        logger.info("Seeded %d project templates", len(docs))
    except Exception as e:
        logger.warning("Failed to seed project templates: %s", e)
