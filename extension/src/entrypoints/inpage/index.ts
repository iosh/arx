import { bootstrapInpageProvider } from "@arx/provider/inpage";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

export default defineUnlistedScript(() => {
  bootstrapInpageProvider();
});
