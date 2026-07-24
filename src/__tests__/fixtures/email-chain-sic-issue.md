---
when: 2026-05-22
tags:
  - note
---
# Participants


# Summary



# Email Chain

I would assume PCE would be next. They need to turn that metric on or see why it isn't producing data.


Will

---

**From:** Yun, Stella <[xiaoyang.yun@hpe.com](mailto:xiaoyang.yun@hpe.com)>  
**Sent:** Thursday, May 21, 2026 1:46 PM  
**To:** Colton, Will <[will.colton@hpe.com](mailto:will.colton@hpe.com)>; Pahwa, Kashish <[kashish.pahwa@hpe.com](mailto:kashish.pahwa@hpe.com)>; Lankababu, Kanumuri <[kanumuri.lankababu@hpe.com](mailto:kanumuri.lankababu@hpe.com)>; Hirve, Sayali <[sayali.hirve@hpe.com](mailto:sayali.hirve@hpe.com)>; Siebert, Czarena <[czarena.siebert@hpe.com](mailto:czarena.siebert@hpe.com)>; Tronkowski, Kevin <[kevin.tronkowski@hpe.com](mailto:kevin.tronkowski@hpe.com)>  
**Cc:** GL Platform Services Support <[glplatformservices@hpe.com](mailto:glplatformservices@hpe.com)>  
**Subject:** Re: Sustainability Insight Center Issue-5402774744

Thanks Will. Who can help debugging it further, PCE or OpsRamp?

  

**From:** Colton, Will <[will.colton@hpe.com](mailto:will.colton@hpe.com)>  
**Date:** Thursday, May 21, 2026 at 10:44 AM  
**To:** Pahwa, Kashish <[kashish.pahwa@hpe.com](mailto:kashish.pahwa@hpe.com)>; Yun, Stella <[xiaoyang.yun@hpe.com](mailto:xiaoyang.yun@hpe.com)>; Lankababu, Kanumuri <[kanumuri.lankababu@hpe.com](mailto:kanumuri.lankababu@hpe.com)>; Hirve, Sayali <[sayali.hirve@hpe.com](mailto:sayali.hirve@hpe.com)>; Siebert, Czarena <[czarena.siebert@hpe.com](mailto:czarena.siebert@hpe.com)>; Tronkowski, Kevin <[kevin.tronkowski@hpe.com](mailto:kevin.tronkowski@hpe.com)>  
**Cc:** GL Platform Services Support <[glplatformservices@hpe.com](mailto:glplatformservices@hpe.com)>  
**Subject:** Re: Sustainability Insight Center Issue-5402774744  
  

Looking at data in their PCE OpsRamp tenant (which we have configured as "7f1562a1-5a03-4e39-9f9a-6f2dace4f075"), it looks like there are no hpe_pdu3_input_power_watts metrics being reported.  That is the metric that we use to gather power data from PCE accounts.

  

Let me know if you need more info.

  

Will

---

**From:** Pahwa, Kashish <[kashish.pahwa@hpe.com](mailto:kashish.pahwa@hpe.com)>  
**Sent:** Thursday, May 21, 2026 1:36 PM  
**To:** Yun, Stella <[xiaoyang.yun@hpe.com](mailto:xiaoyang.yun@hpe.com)>; Lankababu, Kanumuri <[kanumuri.lankababu@hpe.com](mailto:kanumuri.lankababu@hpe.com)>; Hirve, Sayali <[sayali.hirve@hpe.com](mailto:sayali.hirve@hpe.com)>; Siebert, Czarena <[czarena.siebert@hpe.com](mailto:czarena.siebert@hpe.com)>; Tronkowski, Kevin <[kevin.tronkowski@hpe.com](mailto:kevin.tronkowski@hpe.com)>; Colton, Will <[will.colton@hpe.com](mailto:will.colton@hpe.com)>  
**Cc:** GL Platform Services Support <[glplatformservices@hpe.com](mailto:glplatformservices@hpe.com)>  
**Subject:** Re: Sustainability Insight Center Issue-5402774744

Thanks Stella.

---

**From:** Yun, Stella <[xiaoyang.yun@hpe.com](mailto:xiaoyang.yun@hpe.com)>  
**Sent:** Thursday, May 21, 2026 10:24 AM  
**To:** Lankababu, Kanumuri <[kanumuri.lankababu@hpe.com](mailto:kanumuri.lankababu@hpe.com)>; Hirve, Sayali <[sayali.hirve@hpe.com](mailto:sayali.hirve@hpe.com)>; Pahwa, Kashish <[kashish.pahwa@hpe.com](mailto:kashish.pahwa@hpe.com)>; Siebert, Czarena <[czarena.siebert@hpe.com](mailto:czarena.siebert@hpe.com)>; Tronkowski, Kevin <[kevin.tronkowski@hpe.com](mailto:kevin.tronkowski@hpe.com)>; Colton, Will <[will.colton@hpe.com](mailto:will.colton@hpe.com)>  
**Cc:** GL Platform Services Support <[glplatformservices@hpe.com](mailto:glplatformservices@hpe.com)>  
**Subject:** Re: Sustainability Insight Center Issue-5402774744

The eng team is looking into this.

  

**From:** Lankababu, Kanumuri <[kanumuri.lankababu@hpe.com](mailto:kanumuri.lankababu@hpe.com)>  
**Date:** Thursday, May 21, 2026 at 1:35 AM  
**To:** Hirve, Sayali <[sayali.hirve@hpe.com](mailto:sayali.hirve@hpe.com)>; Pahwa, Kashish <[kashish.pahwa@hpe.com](mailto:kashish.pahwa@hpe.com)>; Siebert, Czarena <[czarena.siebert@hpe.com](mailto:czarena.siebert@hpe.com)>; Tronkowski, Kevin <[kevin.tronkowski@hpe.com](mailto:kevin.tronkowski@hpe.com)>; Yun, Stella <[xiaoyang.yun@hpe.com](mailto:xiaoyang.yun@hpe.com)>  
**Cc:** GL Platform Services Support <[glplatformservices@hpe.com](mailto:glplatformservices@hpe.com)>  
**Subject:** RE: Sustainability Insight Center Issue-5402774744  
  

Hello SIC Team,

This is the follow-up email

The customer has provisioned the Sustainable Insight Center in the US region because the HPE documentation states that the Insight Center must be deployed in the same location as the Private Cloud Enterprise (PCE).

The provisioning was completed successfully and all data appears healthy in Green status with no warnings displayed on the dashboard. However, when checked in the HPE Sustainability Insights Center, no statistics or data from the PCE environment are being displayed.

This is the reason the customer opened the support ticket. Could you please help investigate why the statistics are not being populated in SIC?

Customer email: [loic.harrang@roullier.com](mailto:loic.harrang@roullier.com "mailto:loic.harrang@roullier.com")

Workspace Name: CFPR - Groupe Roullier

Workspace ID: 716e0ebec9f311eebb76ca81f4262eb4

For any feedback, please feel free to write to [glplatformservices@hpe.com](mailto:glplatformservices@hpe.com "mailto:glplatformservices@hpe.com") for an immediate response.

Regards,

**Lankababu kanumuri**

GreenLake Platform Services Engineer

Working hours – 13:30 – 22:30 IST

Weekly off – Friday & Saturday

**Hewlett Packard Enterprise**

**Hpe.com**

**![Image](cid:4223574575*image001.png@01DCE92A.E29B9EA0)**

**From:** Lankababu, Kanumuri <[kanumuri.lankababu@hpe.com](mailto:kanumuri.lankababu@hpe.com)>  
**Sent:** Tuesday, 19 May, 2026 05:46 PM  
**To:** Hirve, Sayali <[sayali.hirve@hpe.com](mailto:sayali.hirve@hpe.com)>; Pahwa, Kashish <[kashish.pahwa@hpe.com](mailto:kashish.pahwa@hpe.com)>; Siebert, Czarena <[czarena.siebert@hpe.com](mailto:czarena.siebert@hpe.com)>; Tronkowski, Kevin <[kevin.tronkowski@hpe.com](mailto:kevin.tronkowski@hpe.com)>; Yun, Stella <[xiaoyang.yun@hpe.com](mailto:xiaoyang.yun@hpe.com)>  
**Cc:** GL Platform Services Support <[glplatformservices@hpe.com](mailto:glplatformservices@hpe.com)>  
**Subject:** Sustainability Insight Center Issue-5402774744

Hello SIC Team,

The customer has provisioned the Sustainable Insight Center in the US region because the HPE documentation states that the Insight Center must be deployed in the same location as the Private Cloud Enterprise (PCE).

The provisioning was completed successfully and all data appears healthy in Green status with no warnings displayed on the dashboard. However, when checked in the HPE Sustainability Insights Center, no statistics or data from the PCE environment are being displayed.

This is the reason the customer opened the support ticket. Could you please help investigate why the statistics are not being populated in SIC?

Customer email: [loic.harrang@roullier.com](mailto:loic.harrang@roullier.com "mailto:loic.harrang@roullier.com")

Workspace Name: CFPR - Groupe Roullier

Workspace ID: 716e0ebec9f311eebb76ca81f4262eb4

For any feedback, please feel free to write to [glplatformservices@hpe.com](mailto:glplatformservices@hpe.com "mailto:glplatformservices@hpe.com") for an immediate response.

Regards,

**Lankababu kanumuri**

GreenLake Platform Services Engineer

Working hours – 13:30 – 22:30 IST

Weekly off – Friday & Saturday

**Hewlett Packard Enterprise**

**Hpe.com**

**![Image](cid:4223574575*image001.png@01DCE92A.E29B9EA0)**