async function init(){const response=await fetch("/api/auth/me");if(!response.ok)location.href="/inloggen"}
document.querySelector("#logout").addEventListener("click",async()=>{await fetch("/api/auth/logout",{method:"POST"});location.href="/inloggen"});
init();
