import uuid
from datetime import datetime, timezone
from database import db
from core.logger import get_logger

logger = get_logger(__name__)


def _t(title, phase, owner, offset, details=""):
    """Shorthand for building a template task dict."""
    return {
        "title": title,
        "phase": phase,
        "owner": owner,
        "offset_days": offset,
        "details": details,
    }


TEMPLATES = [
    {
        "name": "Single-session workshop",
        "event_format": "workshop",
        "default_tasks": [
            _t(
                "Confirm date and time with partner",
                "planning", "internal", -42,
                "Check against partner calendar and local conflicts",
            ),
            _t(
                "Confirm room and AV details",
                "planning", "partner", -38,
                "Capacity, AV setup, Wi-Fi, parking, signage",
            ),
            _t(
                "Finalize workshop content",
                "planning", "internal", -35,
                "Slide deck, handouts, prompt cheat sheets",
            ),
            _t(
                "Draft flyer and promo materials",
                "planning", "internal", -32,
                "Customizable per community with logos and venue",
            ),
            _t(
                "Partner approves flyer",
                "planning", "partner", -30,
                "Review for accuracy and co-branding",
            ),
            _t(
                "Set up registration",
                "planning", "internal", -28,
                "Google Form, Eventbrite, or platform-native",
            ),
            _t(
                "Identify local co-promoters",
                "planning", "both", -28,
                "Other orgs, social media pages, newsletters",
            ),
            _t(
                "Share flyer to partner channels",
                "promotion", "partner", -28,
                "Newsletter, social, lobby posting, website",
            ),
            _t(
                "Share flyer to Iowa Center channels",
                "promotion", "internal", -28,
                "Email list, social, cross-posts",
            ),
            _t(
                "Send reminder to co-promoters",
                "promotion", "internal", -21,
                "Chamber newsletter deadlines, local media",
            ),
            _t(
                "Registration check-in (midpoint)",
                "promotion", "internal", -14,
                "Review numbers, decide if extra push needed",
            ),
            _t(
                "Final reminder blast",
                "promotion", "both", -5,
                "3-5 days before event",
            ),
            _t(
                "Confirm headcount with partner",
                "promotion", "internal", -3,
                "Room setup, materials count",
            ),
            _t(
                "Confirm room setup",
                "delivery", "partner", 0,
                "Tables, chairs, projector, Wi-Fi credentials",
            ),
            _t(
                "Arrive for tech check",
                "delivery", "internal", 0,
                "30-45 minutes before start",
            ),
            _t(
                "Run sign-in and check-in",
                "delivery", "internal", 0,
                "Capture attendee info for follow-up",
            ),
            _t("Deliver workshop", "delivery", "internal", 0),
            _t(
                "Distribute implementation kit",
                "delivery", "internal", 0,
                "Handouts, cheat sheets, resource links",
            ),
            _t(
                "Collect feedback survey",
                "delivery", "internal", 0,
                "Paper or QR code to digital survey",
            ),
            _t(
                "Send thank-you to partner",
                "follow_up", "internal", 1,
                "Include attendance summary, photos",
            ),
            _t(
                "Send attendee follow-up email",
                "follow_up", "internal", 2,
                "Survey link, resources, next steps",
            ),
            _t(
                "Log attendance and outcomes",
                "follow_up", "internal", 5,
                "How many, who, warm leads for coaching/lending",
            ),
            _t(
                "Schedule partner debrief",
                "follow_up", "internal", 7,
                "What worked, what to adjust, next session interest",
            ),
            _t(
                "Update partner org profile",
                "follow_up", "internal", 10,
                "Notes on venue, relationship, future availability",
            ),
        ],
    },
    {
        "name": "New partner onboarding",
        "event_format": "onboarding",
        "default_tasks": [
            _t("Intro meeting or call", "planning", "internal", -42),
            _t(
                "Identify partner goals and audience needs",
                "planning", "internal", -38,
            ),
            _t(
                "Share org overview and service menu",
                "planning", "internal", -35,
            ),
            _t("Confirm mutual interest", "planning", "both", -30),
            _t(
                "Identify primary and secondary contacts",
                "promotion", "partner", -28,
            ),
            _t(
                "Collect venue details",
                "promotion", "partner", -25,
                "Capacity, AV, schedule availability",
            ),
            _t(
                "Agree on co-branding guidelines",
                "promotion", "both", -21,
            ),
            _t(
                "Agree on promotion responsibilities",
                "promotion", "both", -21,
            ),
            _t("Select first class to pilot", "promotion", "both", -18),
            _t("Set pilot date", "promotion", "both", -14),
            _t(
                "Pilot evaluation",
                "follow_up", "both", 7,
                "Does both sides want to continue? What cadence?",
            ),
            _t(
                "Move partner to active status",
                "follow_up", "internal", 10,
                "Set up quarterly check-in schedule",
            ),
        ],
    },
    {
        "name": "Partner-hosted office hours",
        "event_format": "office_hours",
        "default_tasks": [
            _t("Confirm date with partner", "planning", "internal", -14),
            _t(
                "Notify partner of visit",
                "promotion", "internal", -7,
            ),
            _t(
                "Partner posts to their channels",
                "promotion", "partner", -5,
                "Lobby sign, newsletter mention",
            ),
            _t("Show up and set up", "delivery", "internal", 0),
            _t(
                "Log visitors and conversations",
                "follow_up", "internal", 1,
                "Track foot traffic, warm leads, follow-up needed",
            ),
        ],
    },
]


async def seed_project_templates():
    """Insert default project templates if the collection is empty."""
    try:
        count = await db.project_templates.estimated_document_count()
        if count > 0:
            return
        now = datetime.now(timezone.utc).isoformat()
        docs = []
        for tmpl in TEMPLATES:
            docs.append({
                "id": str(uuid.uuid4()),
                "name": tmpl["name"],
                "event_format": tmpl["event_format"],
                "default_tasks": tmpl["default_tasks"],
                "collateral_kit": [],
                "created_at": now,
            })
        await db.project_templates.insert_many(docs)
        logger.info("Seeded %d project templates", len(docs))
    except Exception as e:
        logger.warning("Failed to seed project templates: %s", e)
