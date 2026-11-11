import http from "k6/http";
import {check} from "k6";

export const options={
  scenarios:{
    board:{
      executor:"constant-vus",
      vus:100,
      duration:"25s"
    }
  },
  thresholds:{
    "http_req_duration":["p(95)<200"],
    "http_req_failed":["rate<0.01"]
  }
};
const BASE=__ENV.BASE_URL||"http://localhost:4000";
export default function(){
  const r=http.get(BASE+"/api/board?page=0");
  check(r,{"HTTP 200":x=>x.status===200});
}
export function handleSummary(data){
  return {
    "load-results.json":JSON.stringify(data,null,2),
    stdout:"p95="+JSON.stringify(data.metrics.http_req_duration?.values?.["p(95)"])+" ms\n"
  };
}
