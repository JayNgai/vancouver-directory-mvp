ITINERARIES = [
    {
        "title": "Gastown Foodie Tour",
        "duration": "2-3 hours",
        "difficulty": "Easy",
        "neighborhoods": ["Gastown", "Downtown"],
        "description": "Experience Gastown's best artisanal food scene with stops at The Nest, Salumi Meatshop, and Pike Street Market.",
        "highlights": ["The Steam Clock photo op", "Pike Place Market vendors", "Cobblestone alleyways"],
        "steps": [
            {"time": "1:00 PM", "activity": "Start at Pike Street Market for fresh seafood"},
            {"time": "1:30 PM", "activity": "Visit The Nest for fine dining experience"},
            {"time": "2:15 PM", "activity": "Stop at Cafe Coquetier for French café vibes"},
            {"time": "3:00 PM", "activity": "Finish at the Steam Clock for photos"}
        ]
    },
    {
        "title": "Downtown Cultural Walk",
        "duration": "2 hours",
        "difficulty": "Easy",
        "neighborhoods": ["Downtown"],
        "description": "Explore Vancouver's cultural heart with world-class museums and art galleries.",
        "highlights": ["Vancouver Art Gallery", "Canada Place", "Granville Street Shopping"],
        "steps": [
            {"time": "10:00 AM", "activity": "Start at Vancouver Art Gallery"},
            {"time": "12:00 PM", "activity": "Lunch at The Keg Steakhouse"},
            {"time": "1:30 PM", "activity": "Walk along Canada Place waterfront"},
            {"time": "2:30 PM", "activity": "Shop Granville Street boutiques"}
        ]
    },
    {
        "title": "Kitsilano Beach & Fitness Experience",
        "duration": "3-4 hours",
        "difficulty": "Moderate",
        "neighborhoods": ["Kitsilano"],
        "description": "Canada's premier beach destination with world-class fitness culture.",
        "highlights": ["Kitsilano Beach", "Beach Volleyball Courts", "Quilchena Aquarium"],
        "steps": [
            {"time": "10:00 AM", "activity": "Arrive at Kitsilano Beach"},
            {"time": "11:00 AM", "activity": "Beach yoga or fitness activities"},
            {"time": "12:30 PM", "activity": "Lunch at The Crafty Drinker"},
            {"time": "2:00 PM", "activity": "Visit Quilchena Aquarium"}
        ]
    },
    {
        "title": "Yaletown Seawall Adventure",
        "duration": "1.5-2 hours",
        "difficulty": "Easy",
        "neighborhoods": ["Yaletown"],
        "description": "Walk the famous Yaletown Seawall alongside False Creek with stunning views.",
        "highlights": ["False Creek Waterfront", "Rideau Centre Shopping", "Water Taxi Views"],
        "steps": [
            {"time": "2:00 PM", "activity": "Start at Granville Street"},
            {"time": "2:30 PM", "activity": "Walk along Yaletown Seawall"},
            {"time": "3:15 PM", "activity": "Visit Tilth Coffee for specialty drinks"},
            {"time": "4:00 PM", "activity": "End at Coal Harbour marina"}
        ]
    },
    {
        "title": "Commercial Drive Bohemian Day",
        "duration": "3-4 hours",
        "difficulty": "Easy",
        "neighborhoods": ["Commercial Drive"],
        "description": "Vancouver's most culturally diverse neighborhood with independent shops and cafes.",
        "highlights": ["Diverse international cuisine", "Vintage stores", "Art galleries"],
        "steps": [
            {"time": "11:00 AM", "activity": "Start at The Butchers Cafe"},
            {"time": "12:30 PM", "activity": "Lunch at local ethnic restaurant"},
            {"time": "2:00 PM", "activity": "Shop vintage and independent boutiques"},
            {"time": "3:30 PM", "activity": "Explore local art galleries"}
        ]
    }
]

# Save itineraries for API endpoint
with open(f"{PROJECT_PATH}/itineraries.py", "w") as f:
    f.write(f"ITINERARIES = {repr(ITINERARIES)}")

print("✅ ITINERARIES CREATED - 5 curated experiences built!")
print()
print("Itinerary breakdown:")
print(f"  • Gastown Foodie Tour (2-3 hours)")
print(f"  • Downtown Cultural Walk (2 hours)")
print(f"  • Kitsilano Beach & Fitness (3-4 hours)")
print(f"  • Yaletown Seawall Adventure (1.5-2 hours)")
print(f"  • Commercial Drive Bohemian Day (3-4 hours)")
