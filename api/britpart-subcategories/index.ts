import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

type BPSubcat = {
  id: number;
  title: string;
  description?: string;
  url?: string;
  subcategoryIds?: number[];
};

type BPCatalog = {
  id: number;
  title: string;
  description?: string;
  url?: string;
  subcategories: BPSubcat[];
  subcategoryIds?: number[];
};

// ---- Klistra in ditt JSON här (oförändrat) ----
const RAW: BPCatalog = {
  "subcategories": [
    {
      "id": 40,
      "title": "Camping",
      "description": "<p>A range of camping equipment including ARB fridge freezers, chairs, awnings and wind breaks.</p>",
      "url": "https://www.britpart.com/parts/camping",
      "partCodes": [],
      "subcategoryIds": [187,188,222,228,229]
    },
    {
      "id": 41,
      "title": "Chassis & Body Components",
      "description": "<p>From a complete chassis, down to the smallest fixing kit, you will find everything you need with our selection of chassis and body components for your Land Rover.</p>",
      "url": "https://www.britpart.com/parts/chassis-and-body-components",
      "partCodes": [],
      "subcategoryIds": [101,102,103,147,161,230,231]
    },
    {
      "id": 42,
      "title": "Consumables",
      "description": "<p>Everyday consumable items for use in the workshop, from bearing grease to oils and coolants you will find everything you need here.</p>",
      "url": "https://www.britpart.com/parts/consumables",
      "partCodes": [],
      "subcategoryIds": [104,105,151,153,232,233,234,1240,1241,1242,1243,1244,1245,1246,1247]
    },
    {
      "id": 43,
      "title": "Enhancements",
      "description": "<p>At Britpart we pride ourselves in continually developing the latest enhancements for your Land Rover. We offer an extensive range of accessories and enhancements to ensure that your Land Rover has that extra special look and stands out from the crowd! From Series to Discovery Sport, we have a host of enhancements so you can customise your Land Rover.</p>",
      "url": "https://www.britpart.com/parts/enhancements",
      "partCodes": [],
      "subcategoryIds": [1133,1138,1144,1153,1258]
    },
    {
      "id": 44,
      "title": "Exterior Protection",
      "description": "<p>Going off-road? Here&rsquo;s where to find all the equipment your Land Rover will need to protect it from all the hidden dangers you may encounter.</p>",
      "url": "https://www.britpart.com/parts/exterior-protection",
      "partCodes": [],
      "subcategoryIds": [63,64,65,66,67,68,69,70,195,235]
    },
    {
      "id": 45,
      "title": "Interior Protection",
      "description": "<p>Britpart has everything you need to keep the inside of your Land Rover in great condition with our range of interior protection. We have items such as dog guards, loadspace liners, mats and waterproof seat covers for a variety of Land Rovers.&nbsp;</p>",
      "url": "https://www.britpart.com/parts/interior-protection",
      "partCodes": [],
      "subcategoryIds": [73,74,75,76,236,740]
    },
    {
      "id": 46,
      "title": "Lighting",
      "description": "<p>Be seen and light the way with a decent set of driving lamps for your Land Rover. Or convert your existing lights into something more powerful with our range of kits including the Britpart Lynx Eye LED kit.</p>",
      "url": "https://www.britpart.com/parts/lighting",
      "partCodes": [],
      "subcategoryIds": [77,78,79,169,176,181,237,238]
    },
    {
      "id": 47,
      "title": "Lucas & Girling Classic",
      "description": "",
      "url": "https://www.britpart.com/parts/lucas-classic",
      "partCodes": [],
      "subcategoryIds": [204,205,206,207,208,209,210,211,212,213,214,215,216,221,1248]
    },
    {
      "id": 48,
      "title": "Miscellaneous",
      "description": "<p>We have a vast selection of items including Britpart merchandise, Land Rover gift ideas, books &amp; manuals, camping equipment, security equipment and much more.</p>",
      "url": "https://www.britpart.com/parts/miscellaneous",
      "partCodes": [],
      "subcategoryIds": [80,81,82,83,84,149,157,182]
    },
    {
      "id": 49,
      "title": "Off-Road",
      "description": "<p>Be prepared for the unexpected when exploring in your Land Rover. You&rsquo;ll find products to suit your off-road adventures from long range fuel tanks to diff lockers and Hi-Lift jacks, we have everything you need for your Land Rover.</p>",
      "url": "https://www.britpart.com/parts/off-road",
      "partCodes": [],
      "subcategoryIds": [85,86,87,88,89,91,92,1167]
    },
    {
      "id": 50,
      "title": "Performance",
      "description": "<p>Upgrade your Land Rover from its standard spec into something a bit more special with upgrades for the braking system and engines.</p>",
      "url": "https://www.britpart.com/parts/performance",
      "partCodes": [],
      "subcategoryIds": [93,94,95,1168]
    },
    {
      "id": 51,
      "title": "Racks & Roll Cages",
      "description": "<p>We have a variety of racks and luggage boxes to suit all Land Rovers and all types of loads. We also have a selection of roll cages for additional safety in your Land Rover.&nbsp;</p>",
      "url": "https://www.britpart.com/parts/racks-and-roll-cages",
      "partCodes": [],
      "subcategoryIds": [96,97,98,145,152,749]
    },
    {
      "id": 52,
      "title": "Repair & Service Parts",
      "description": "<p>We have everything you need for those repair and service jobs on your Land Rover! Our extensive range of repair and service parts includes complete chassis, body components, service kits, consumables, tools and much more.</p>",
      "url": "https://www.britpart.com/parts/repair-and-service-parts",
      "partCodes": [],
      "subcategoryIds": [99,100,106,107,108,109,186]
    },
    {
      "id": 53,
      "title": "Seats & Trim",
      "description": "<p>Keep your Land Rovers interior looking great with our extensive selection of seat and trim parts. We have seats and cubby boxes available in a multitude of materials and colours to suit your Land Rover&#39;s appearance.</p>",
      "url": "https://www.britpart.com/parts/seats-and-trim",
      "partCodes": [],
      "subcategoryIds": [112,113,116,117,118,119,155,219,220,227]
    },
    {
      "id": 54,
      "title": "Service Kits",
      "description": "<p>An extensive selection of Britpart, genuine or alternative brand service kits for most Land Rover models.&nbsp;</p>",
      "url": "https://www.britpart.com/parts/service-kits",
      "partCodes": ["SERVICESTICKERPK"],
      "subcategoryIds": [174,179]
    },
    {
      "id": 55,
      "title": "Side & Rear Steps",
      "description": "<p>Add some smart new steps to you Land Rover for assistance when getting in and out. We have a variety of side and rear steps in different patterns and treads for most Land Rovers to suit your requirements.&nbsp;</p>",
      "url": "https://www.britpart.com/parts/side-and-rear-steps",
      "partCodes": [],
      "subcategoryIds": [197,198,199,200]
    },
    {
      "id": 56,
      "title": "Tools",
      "description": "<p>An extensive range of specialist workshop tools for servicing and repairing Land Rovers.&nbsp;</p>",
      "url": "https://www.britpart.com/parts/tools",
      "partCodes": [],
      "subcategoryIds": [110,148,159,162,163,164,165,167,168,225,737,738,739]
    },
    {
      "id": 57,
      "title": "Towing",
      "description": "<p>Britpart have everything you need for towing that load with your Land Rover. From Series to Discovery Sport, we have towing hitches and ancillary parts to fit most Land Rovers.&nbsp;</p>",
      "url": "https://www.britpart.com/parts/towing",
      "partCodes": [],
      "subcategoryIds": [189,190,191,192,193,194]
    },
    {
      "id": 58,
      "title": "Wheels",
      "description": "<p>Great choice of wheel designs to enhance your Land Rover&rsquo;s appearance. Designs include alloy, steel, Zu, Bowler and MaxXtrac wheels for many Land Rover models.</p>",
      "url": "https://www.britpart.com/parts/wheels",
      "partCodes": [],
      "subcategoryIds": [134,136,139,226,741]
    },
    {
      "id": 59,
      "title": "Winching",
      "description": "<p>Never get stuck again with a Britpart Pulling Power electric winch and winching accessories - we&#39;ve all you need to get out of that sticky situation.</p>",
      "url": "https://www.britpart.com/parts/winching",
      "partCodes": [],
      "subcategoryIds": [140,141,142,143,1154,1252]
    },
    {
      "id": 60,
      "title": "Suspension & Axle",
      "description": "<p>We have plenty of suspension upgrade options for your Land Rover. So why not firm up your ride with some new shock absorbers &amp; springs, or raise your game with a lifted suspension kit!&nbsp;</p>",
      "url": "https://www.britpart.com/parts/suspension-and-axle",
      "partCodes": [],
      "subcategoryIds": [120,121,122,123,124,125,126,128,146,196]
    },
    {
      "id": 62,
      "title": "Clearance Accessories",
      "description": "",
      "url": "https://www.britpart.com/parts/clearance",
      "partCodes": ["215717","ANR6316MNHLR","DA1570","DA2261","DA3008","DA3092","DA3102","DA3119","DA3126","DA3128","DA3133","DA3151","DA3211","DA3417","DA3640","DA3641","DA4049SL","DA4311","DA4450","DA5067","DA5642","DA6429","DA6820","DA6821","DA6822","DA8013","DA8201","DB1359","DB9500IRARB","LR001153LR","LR008766LR","LR010666LR","LR017280LR","LR031222LR","LRSS12RSPH","RRC500251MNHLR","RRC504630MNHLR"],
      "subcategoryIds": []
    }
  ],
  "parentId": 0,
  "id": 3,
  "title": "All Parts",
  "description": "<p>At Britpart, we pride ourselves on offering an extensive accessory range to meet the needs of Land Rover owners...</p>",
  "url": "https://www.britpart.com/parts",
  "partCodes": [],
  "subcategoryIds": [40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,62]
};
// --------------------------------------------

app.http("britpart-subcategories", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (_req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> => {
    const items = (RAW.subcategories || [])
      .map(sc => ({ id: String(sc.id), name: sc.title }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { jsonBody: { items } };
  },
});