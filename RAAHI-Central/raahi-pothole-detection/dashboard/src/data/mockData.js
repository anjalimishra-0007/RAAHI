export const initialBuses = [
  { id:'RAAHI-01', route:'Route 7A', lat:28.6139, lng:77.2090, speed:32, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-02', route:'Route 12', lat:28.6215, lng:77.2167, speed:21, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-03', route:'Route 4', lat:28.6062, lng:77.2231, speed:14, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-04', route:'Route 18', lat:28.6287, lng:77.1984, speed:0, status:'offline', camera:false, lastSeen:'4m ago' },
  { id:'RAAHI-05', route:'Route 22', lat:28.5988, lng:77.2114, speed:38, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-06', route:'Route 3', lat:28.6321, lng:77.2262, speed:27, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-07', route:'Route 9', lat:28.6154, lng:77.2332, speed:19, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-08', route:'Route 15', lat:28.5927, lng:77.2292, speed:25, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-09', route:'Route 6', lat:28.6401, lng:77.2104, speed:30, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-10', route:'Route 11', lat:28.6019, lng:77.1942, speed:17, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-11', route:'Route 14', lat:28.6203, lng:77.1902, speed:23, status:'online', camera:true, lastSeen:'Now' },
  { id:'RAAHI-12', route:'Route 20', lat:28.6334, lng:77.2401, speed:29, status:'online', camera:true, lastSeen:'Now' }
];

export const initialIncidents = [
  {id:101,type:'Pothole',severity:'high',confidence:94,time:'10:32 AM',lat:28.6139,lng:77.2090,bus:'RAAHI-01',status:'open',size:'420 × 185 px',evidence:'/raahi-camera-sample.png'},
  {id:102,type:'Congestion',severity:'high',confidence:91,time:'10:31 AM',lat:28.6215,lng:77.2167,bus:'RAAHI-02',status:'open',size:'71 vehicles',evidence:'/raahi-camera-sample.png'},
  {id:103,type:'Pothole',severity:'medium',confidence:89,time:'10:28 AM',lat:28.6062,lng:77.2231,bus:'RAAHI-03',status:'open',size:'260 × 120 px',evidence:'/raahi-camera-sample.png'},
  {id:104,type:'Missing Zebra Crossing',severity:'medium',confidence:87,time:'10:24 AM',lat:28.6287,lng:77.1984,bus:'RAAHI-04',status:'open',size:'1 road marking',evidence:'/raahi-camera-sample.png'},
  {id:105,type:'Waterlogging',severity:'critical',confidence:96,time:'10:19 AM',lat:28.5988,lng:77.2114,bus:'RAAHI-05',status:'open',size:'High coverage',evidence:'/raahi-camera-sample.png'},
  {id:106,type:'Rash Driving',severity:'high',confidence:92,time:'10:14 AM',lat:28.6321,lng:77.2262,bus:'RAAHI-06',status:'open',size:'82 km/h',evidence:'/raahi-camera-sample.png'},
  {id:107,type:'Pothole',severity:'low',confidence:84,time:'10:09 AM',lat:28.6154,lng:77.2332,bus:'RAAHI-07',status:'resolved',size:'140 × 80 px',evidence:'/raahi-camera-sample.png'},
  {id:108,type:'Congestion',severity:'medium',confidence:88,time:'10:03 AM',lat:28.5927,lng:77.2292,bus:'RAAHI-08',status:'open',size:'48 vehicles',evidence:'/raahi-camera-sample.png'}
];

export const vehicleBreakdown = {Cars:42,Buses:4,Bikes:18,Trucks:7};
