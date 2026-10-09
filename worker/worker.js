export default {
 async fetch(request) {
  const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Content-Type":"application/json; charset=utf-8"};
  if(request.method==="OPTIONS") return new Response(null,{headers});
  if(request.method!=="POST") return Response.json({message:"Method not allowed"},{status:405,headers});
  try {
   const body=await request.json(); const input=new URL(body.url);
   if(!["link4m.com","www.link4m.com"].includes(input.hostname)||!["http:","https:"].includes(input.protocol))
    return Response.json({message:"Chỉ chấp nhận link4m.com."},{status:400,headers});
   // Follow ordinary HTTP redirects. This does not execute page JavaScript or pass verification gates.
   const response=await fetch(input.href,{method:"GET",redirect:"follow",headers:{"User-Agent":"Mozilla/5.0 (compatible; Link4MResolver/1.0)"}});
   return Response.json({finalUrl:response.url||input.href,redirected:response.redirected},{headers});
  } catch(e) {
   return Response.json({message:"Không thể phân giải chuyển hướng HTTP của liên kết này."},{status:502,headers});
  }
 }
};
