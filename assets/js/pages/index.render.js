// /assets/js/pages/index.render.js
import { $, n, fmt2 } from "./index.lib.js";
import { matchSearch, sortItems, cardHTML, rankRowHTML, leadRowHTML, fmt1 } from "./index.lib.js";

export function computeKpi(items){
  const published = items.length;
  let sumReviews = 0;
  let sumWeighted = 0;
  let countWeighted = 0;

  for(const it of items){
    const c = n(it.reviewCount,0);
    const a = n(it.reviewAvg,0);
    sumReviews += c;
    sumWeighted += a * c;
    countWeighted += c;
  }

  const weightedAvg = countWeighted > 0 ? (sumWeighted / countWeighted) : 0;

  $("#kpiPublished").textContent = String(published);
  $("#kpiReviews").textContent = String(sumReviews);
  $("#kpiAvg").textContent = countWeighted > 0 ? fmt2(weightedAvg) : "-";
}

export function fillCategoryOptions(items){
  const set = new Set();
  items.forEach(it => set.add(it.category || "기타"));
  const cats = Array.from(set).sort((a,b)=>String(a).localeCompare(String(b)));
  const sel = $("#rankCat");
  sel.innerHTML =
    `<option value="__all__">전체</option>` +
    cats.map(c => `<option value="${c.replace(/"/g,'&quot;')}">${c}</option>`).join("");
}

export function renderItemsGrid(items){
  const q = $("#qSearch").value.trim();
  const sortMode = $("#qSort").value;

  const filtered = items.filter(it => matchSearch(it, q));
  const sorted = sortItems(filtered, sortMode);

  $("#itemsState").textContent = `총 ${sorted.length}개 (published)`;
  $("#itemsGrid").innerHTML = sorted.map(cardHTML).join("");
}

export function renderCategoryRanking(items){
  const cat = $("#rankCat").value;
  const metric = $("#rankMetric").value;

  const pool = items.filter(it => (cat === "__all__" ? true : it.category === cat));
  if(pool.length === 0){
    $("#rankState").textContent = "표시할 항목이 없습니다.";
    $("#rankList").innerHTML = "";
    return;
  }

  let sorted = pool.slice();
  if(metric === "reviews"){
    sorted.sort((a,b)=> (b.reviewCount||0) - (a.reviewCount||0));
  }else if(metric === "rating"){
    sorted.sort((a,b)=>{
      const aa = a.reviewAvg||0, ba = b.reviewAvg||0;
      const ar = a.reviewCount||0, br = b.reviewCount||0;
      if(ba !== aa) return ba - aa;
      return br - ar;
    });
  }else{
    // popular (fallback)
    sorted.sort((a,b)=> (b.popularScore||0) - (a.popularScore||0));
  }

  const top = sorted.slice(0, 6);
  $("#rankState").textContent = `카테고리: ${cat === "__all__" ? "전체" : cat} · 상위 ${top.length}`;
  $("#rankList").innerHTML = top.map((it,i)=>rankRowHTML(i+1, it, metric)).join("");
}

export function computeGuideLeaderboard(items){
  const map = new Map();

  for(const it of items){
    const guideUid = it.guideUid || "unknown";
    const guideName = it.guideName || "";
    const key = guideUid;

    if(!map.has(key)){
      map.set(key, {
        guideUid,
        guideName,
        items: 0,
        reviewCount: 0,
        weightedSum: 0,
        avgSum: 0,
      });
    }

    const g = map.get(key);
    g.items += 1;
    g.guideName = g.guideName || guideName;

    const c = n(it.reviewCount,0);
    const a = n(it.reviewAvg,0);

    g.reviewCount += c;
    g.weightedSum += a * c;

    if(c > 0) g.avgSum += a;
  }

  const arr = Array.from(map.values()).map(g=>{
    const weightedAvg = g.reviewCount > 0 ? (g.weightedSum / g.reviewCount) : 0;
    const itemsAvg = g.items > 0 ? (g.avgSum / g.items) : 0;
    return { ...g, weightedAvg, itemsAvg };
  });

  return arr;
}

export function renderGuideLeaderboard(items){
  const metric = $("#leadMetric").value;
  const leaders = computeGuideLeaderboard(items);

  let sorted = leaders.slice();
  if(metric === "reviews"){
    sorted.sort((a,b)=> (b.reviewCount||0) - (a.reviewCount||0));
  }else if(metric === "items"){
    sorted.sort((a,b)=> (b.items||0) - (a.items||0));
  }else if(metric === "avg"){
    sorted.sort((a,b)=> (b.itemsAvg||0) - (a.itemsAvg||0));
  }else{
    sorted.sort((a,b)=>{
      const aw = a.weightedAvg||0, bw = b.weightedAvg||0;
      const ar = a.reviewCount||0, br = b.reviewCount||0;
      if(bw !== aw) return bw - aw;
      return br - ar;
    });
  }

  const top = sorted.slice(0, 10);
  $("#leadState").textContent = `상위 ${top.length}`;
  $("#leadList").innerHTML = top.map((g,i)=>leadRowHTML(i+1, g, metric)).join("");
}
