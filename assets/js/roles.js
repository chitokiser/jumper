// /assets/js/roles.js

import { watchAuth } from "./auth.js";

export function isAdmin(profile){
  return (profile?.role || "") === "admin";
}

export function isGuide(profile){
  return (profile?.role || "") === "guide";
}

// 레거시(window.__ROLE__) 호환 유지
if(!window.__pg_role_bridge){
  window.__pg_role_bridge = true;
  try{
    watchAuth(({ loggedIn, role })=>{
      window.__ROLE__ = loggedIn ? (role || "user") : "guest";
    });
  }catch(e){
    console.warn("[roles] role bridge failed:", e?.message || e);
  }
}
